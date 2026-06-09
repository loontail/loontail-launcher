import { CONSOLE_BUFFER_LIMIT } from '@shared/constants';
import {
  type ConsoleInitialPayload,
  type ConsoleLevel,
  ConsoleLevels,
  type ConsoleLineArgs,
  type ConsoleProcessState,
  type ConsoleSource,
  ConsoleSources,
} from '@shared/contracts/console';
import type { ClientSlug } from '@shared/contracts/ids';
import { IPC_EVENTS, type IpcEventPayloads } from '@shared/ipc';
import type { BrowserWindow } from 'electron';
import { ConsoleBuffer, type ConsoleLineInput } from './consoleBuffer';
import { ConsoleWindowSink } from './consoleWindowSink';
import { type Log4jEvent, Log4jStreamParser, formatLog4jLine, mapLog4jLevel } from './log4jStream';

type ConsoleEventChannel = (typeof IPC_EVENTS)[
  | 'consoleLines'
  | 'consoleState'
  | 'consoleBufferReset'];

const FLUSH_INTERVAL_MS = 50;

const ANSI_ESCAPE_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences contain ESC (0x1b)
  /\x1b\[[0-9;]*m/g;

const ERROR_LEVEL_PATTERN = /\b(ERROR|SEVERE|FATAL)\b/;
const WARN_LEVEL_PATTERN = /\bWARN(ING)?\b/;
const DEBUG_LEVEL_PATTERN = /\b(DEBUG|TRACE|FINE|FINER|FINEST)\b/;

const stripAnsi = (raw: string): string => raw.replace(ANSI_ESCAPE_PATTERN, '');

const guessLevel = (source: ConsoleSource, message: string): ConsoleLevel => {
  if (source === ConsoleSources.STDERR) return ConsoleLevels.ERROR;
  if (source === ConsoleSources.SYSTEM) return ConsoleLevels.SYSTEM;
  if (ERROR_LEVEL_PATTERN.test(message)) return ConsoleLevels.ERROR;
  if (WARN_LEVEL_PATTERN.test(message)) return ConsoleLevels.WARN;
  if (DEBUG_LEVEL_PATTERN.test(message)) return ConsoleLevels.DEBUG;
  return ConsoleLevels.INFO;
};

const LEVEL_FROM_LOG4J: Record<ReturnType<typeof mapLog4jLevel>, ConsoleLevel> = {
  debug: ConsoleLevels.DEBUG,
  info: ConsoleLevels.INFO,
  warn: ConsoleLevels.WARN,
  error: ConsoleLevels.ERROR,
};

export const buildLineInput = (args: {
  level: ConsoleLevel;
  source: ConsoleSource;
  message: string;
  slug?: ClientSlug | undefined;
  code?: string | undefined;
  args?: ConsoleLineArgs | undefined;
}): ConsoleLineInput => {
  const line: ConsoleLineInput = {
    level: args.level,
    source: args.source,
    message: args.message,
  };
  if (args.slug) line.slug = args.slug;
  if (args.code) {
    line.code = args.code;
    if (args.args) line.args = args.args;
  }
  return line;
};

export type SessionInfo = {
  slug: ClientSlug;
  clientTitle: string;
  state: ConsoleProcessState;
};

export class ConsoleHub {
  private readonly buffer = new ConsoleBuffer({ limit: CONSOLE_BUFFER_LIMIT });
  private readonly sink = new ConsoleWindowSink(() => {
    this.clearFlushTimer();
    this.buffer.clearPending();
  });
  private flushTimer: NodeJS.Timeout | null = null;
  private activeSession: SessionInfo | null = null;
  private readonly log4j = new Log4jStreamParser();

  attach(window: BrowserWindow): void {
    this.sink.attach(window);
  }

  hasWindow(): boolean {
    return this.sink.hasWindow();
  }

  getWindow(): BrowserWindow | null {
    return this.sink.getWindow();
  }

  getInitial(): ConsoleInitialPayload {
    return {
      activeSession: this.activeSession ? { ...this.activeSession } : null,
      lines: this.buffer.getLines(),
      droppedCount: this.buffer.getDroppedCount(),
    };
  }

  clear(): void {
    this.clearFlushTimer();
    this.buffer.clear();
    this.sendToWindow(IPC_EVENTS.consoleBufferReset, null);
  }

  copyAll(): string {
    return this.buffer.copyAll();
  }

  recordMinecraft(
    slug: ClientSlug,
    stream: typeof ConsoleSources.STDOUT | typeof ConsoleSources.STDERR,
    text: string,
  ): void {
    for (const chunk of this.log4j.feed(stream, text)) {
      if (chunk.kind === 'text') {
        this.ingest({ source: stream, raw: chunk.text, slug });
      } else {
        this.ingestLog4jEvent(stream, slug, chunk.event);
      }
    }
  }

  private ingestLog4jEvent(
    source: typeof ConsoleSources.STDOUT | typeof ConsoleSources.STDERR,
    slug: ClientSlug,
    event: Log4jEvent,
  ): void {
    const level = LEVEL_FROM_LOG4J[mapLog4jLevel(event.level)];
    const lines = event.message.split(/\r?\n/);
    const throwableLines = event.throwable ? event.throwable.split(/\r?\n/) : [];
    const all = [...lines, ...throwableLines].filter((line) => line.length > 0);
    if (all.length === 0) return;
    for (const line of all) {
      this.ingest({
        source,
        raw: formatLog4jLine(event, line),
        forcedLevel: level,
        slug,
      });
    }
  }

  recordSystem(
    message: string,
    options?: { code?: string; args?: ConsoleLineArgs; slug?: ClientSlug },
  ): void {
    this.ingest({
      source: ConsoleSources.SYSTEM,
      raw: message,
      forcedLevel: ConsoleLevels.SYSTEM,
      slug: options?.slug,
      code: options?.code,
      args: options?.args,
    });
  }

  setActiveSession(session: SessionInfo | null): void {
    // Drain partial XML left from the previous session before the parser is
    // reset; a trailing fragment would otherwise leak into the new session.
    if (this.activeSession) this.drainLog4j(this.activeSession.slug);
    this.clearFlushTimer();
    this.log4j.reset();
    this.activeSession = session;
  }

  // Flush the log4j stream parsers when the game process exits. A FATAL crash
  // event is often split across the final lines and would otherwise be held in
  // the parser buffer until the next session reset — i.e. discarded. Called by
  // the launch flow before emitting the EXITED/CRASHED state so the last event
  // (the most useful for triage) reaches the console.
  endSession(slug: ClientSlug): void {
    this.drainLog4j(slug);
    this.log4j.reset();
  }

  private drainLog4j(slug: ClientSlug): void {
    for (const stream of [ConsoleSources.STDOUT, ConsoleSources.STDERR] as const) {
      for (const chunk of this.log4j.flush(stream)) {
        if (chunk.kind === 'text' && chunk.text.length > 0) {
          this.ingest({ source: stream, raw: chunk.text, slug });
        } else if (chunk.kind === 'event') {
          this.ingestLog4jEvent(stream, slug, chunk.event);
        }
      }
    }
  }

  emitState(state: ConsoleProcessState): void {
    // Only tag the state with the active session's title when it actually
    // belongs to that session. A terminal state for a different slug (e.g. an
    // older client exiting after a newer launch became active) must keep its
    // own title rather than being mislabeled with the active client's.
    const matchesActive = this.activeSession?.slug === state.slug;
    if (this.activeSession && matchesActive) {
      this.activeSession = {
        ...this.activeSession,
        state: { ...state, clientTitle: this.activeSession.clientTitle },
      };
    }
    const payload: ConsoleProcessState =
      this.activeSession && matchesActive
        ? { ...state, clientTitle: this.activeSession.clientTitle }
        : state;
    this.sendToWindow(IPC_EVENTS.consoleState, payload);
  }

  private ingest(args: {
    source: ConsoleSource;
    raw: string;
    forcedLevel?: ConsoleLevel | undefined;
    slug?: ClientSlug | undefined;
    code?: string | undefined;
    args?: ConsoleLineArgs | undefined;
  }): void {
    const { source, raw, forcedLevel, slug, code, args: lineArgs } = args;
    if (!raw) return;
    const cleaned = stripAnsi(raw);
    // XMLLayout puts `\n  ` (indent) between events; bare length check would
    // admit the two-space line as a row.
    const segments = cleaned.split(/\r?\n/).filter((segment) => segment.trim().length > 0);
    if (segments.length === 0) return;

    const lines: ConsoleLineInput[] = segments.map((segment) =>
      buildLineInput({
        level: forcedLevel ?? guessLevel(source, segment),
        source,
        message: segment,
        slug,
        code,
        args: lineArgs,
      }),
    );
    this.buffer.append(lines);

    if (this.hasWindow()) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const batch = this.buffer.consumePending();
      if (batch.length === 0) return;
      this.sendToWindow(IPC_EVENTS.consoleLines, batch);
    }, FLUSH_INTERVAL_MS);
  }

  // Push any pending lines to the renderer immediately and tear down the flush
  // timer. Called on app shutdown so the last batch isn't lost between the
  // last setTimeout and process exit.
  flushPending(): void {
    this.clearFlushTimer();
    const batch = this.buffer.consumePending();
    if (batch.length === 0) return;
    this.sendToWindow(IPC_EVENTS.consoleLines, batch);
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  // Typed to the console.* event channels so a wrong channel/payload pairing
  // fails tsc instead of silently shipping a mismatched wire shape.
  private sendToWindow<E extends ConsoleEventChannel>(
    channel: E,
    payload: IpcEventPayloads[E],
  ): void {
    this.sink.send(channel, payload);
  }
}

export const createConsoleHub = (): ConsoleHub => new ConsoleHub();

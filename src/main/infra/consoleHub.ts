import {
  type ConsoleInitialPayload,
  type ConsoleLevel,
  ConsoleLevels,
  type ConsoleLine,
  type ConsoleLineArgs,
  type ConsoleProcessState,
  type ConsoleSource,
  ConsoleSources,
} from '@shared/contracts/console';
import type { ClientSlug } from '@shared/contracts/ids';
import { IPC_EVENTS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';
import { type Log4jEvent, Log4jStreamParser, formatLog4jLine, mapLog4jLevel } from './log4jStream';

const BUFFER_LIMIT = 10000;
const FLUSH_INTERVAL_MS = 50;

const ANSI_ESCAPE_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences contain ESC (0x1b)
  /\x1b\[[0-9;]*m/g;

const stripAnsi = (raw: string): string => raw.replace(ANSI_ESCAPE_PATTERN, '');

const guessLevel = (source: ConsoleSource, message: string): ConsoleLevel => {
  if (source === ConsoleSources.STDERR) return ConsoleLevels.ERROR;
  if (source === ConsoleSources.SYSTEM) return ConsoleLevels.SYSTEM;
  if (/\b(ERROR|SEVERE|FATAL)\b/.test(message)) return ConsoleLevels.ERROR;
  if (/\bWARN(ING)?\b/.test(message)) return ConsoleLevels.WARN;
  if (/\b(DEBUG|TRACE|FINE|FINER|FINEST)\b/.test(message)) return ConsoleLevels.DEBUG;
  return ConsoleLevels.INFO;
};

const LEVEL_FROM_LOG4J: Record<ReturnType<typeof mapLog4jLevel>, ConsoleLevel> = {
  debug: ConsoleLevels.DEBUG,
  info: ConsoleLevels.INFO,
  warn: ConsoleLevels.WARN,
  error: ConsoleLevels.ERROR,
};

export type SessionInfo = {
  slug: ClientSlug;
  clientTitle: string;
  state: ConsoleProcessState;
};

class ConsoleHub {
  private window: BrowserWindow | null = null;
  private buffer: ConsoleLine[] = [];
  private pending: ConsoleLine[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private nextId = 0;
  private droppedCount = 0;
  private activeSession: SessionInfo | null = null;
  private readonly log4j = new Log4jStreamParser();

  attach(window: BrowserWindow): void {
    this.window = window;
    window.on('closed', () => {
      // Older window's close event after a quick reopen would otherwise wipe
      // the freshly attached one.
      if (this.window !== window) return;
      this.clearFlushTimer();
      this.pending = [];
      this.window = null;
    });
  }

  hasWindow(): boolean {
    return this.window != null && !this.window.isDestroyed();
  }

  getWindow(): BrowserWindow | null {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window;
  }

  getInitial(): ConsoleInitialPayload {
    return {
      activeSession: this.activeSession ? { ...this.activeSession } : null,
      lines: this.buffer.slice(),
      droppedCount: this.droppedCount,
    };
  }

  clear(): void {
    this.clearFlushTimer();
    this.buffer = [];
    this.pending = [];
    this.droppedCount = 0;
    this.sendToWindow(IPC_EVENTS.consoleBufferReset, null);
  }

  copyAll(): string {
    return this.buffer.map((line) => line.message).join('\n');
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
      ...(options?.slug ? { slug: options.slug } : {}),
      ...(options?.code ? { code: options.code } : {}),
      ...(options?.args ? { args: options.args } : {}),
    });
  }

  setActiveSession(session: SessionInfo | null): void {
    // Drain partial XML left from the previous session before the parser is
    // reset — a trailing fragment would otherwise leak into the new session.
    if (this.activeSession) {
      for (const stream of [ConsoleSources.STDOUT, ConsoleSources.STDERR] as const) {
        for (const chunk of this.log4j.flush(stream)) {
          if (chunk.kind === 'text' && chunk.text.length > 0) {
            this.ingest({ source: stream, raw: chunk.text, slug: this.activeSession.slug });
          } else if (chunk.kind === 'event') {
            this.ingestLog4jEvent(stream, this.activeSession.slug, chunk.event);
          }
        }
      }
    }
    this.clearFlushTimer();
    this.log4j.reset();
    this.activeSession = session;
  }

  emitState(state: ConsoleProcessState): void {
    if (this.activeSession && this.activeSession.slug === state.slug) {
      this.activeSession = {
        ...this.activeSession,
        state: { ...state, clientTitle: this.activeSession.clientTitle },
      };
    }
    const payload: ConsoleProcessState = this.activeSession
      ? { ...state, clientTitle: this.activeSession.clientTitle }
      : state;
    this.sendToWindow(IPC_EVENTS.consoleState, payload);
  }

  private ingest(args: {
    source: ConsoleSource;
    raw: string;
    forcedLevel?: ConsoleLevel;
    slug?: ClientSlug;
    code?: string;
    args?: ConsoleLineArgs;
  }): void {
    const { source, raw, forcedLevel, slug, code, args: lineArgs } = args;
    if (!raw) return;
    const cleaned = stripAnsi(raw);
    // XMLLayout puts `\n  ` (indent) between events; bare length check would
    // admit the two-space line as a row.
    const segments = cleaned.split(/\r?\n/).filter((segment) => segment.trim().length > 0);
    if (segments.length === 0) return;

    const now = Date.now();
    for (const segment of segments) {
      const level: ConsoleLevel = forcedLevel ?? guessLevel(source, segment);
      const line: ConsoleLine = {
        id: this.nextId++,
        timestamp: now,
        level,
        source,
        message: segment,
        ...(slug ? { slug } : {}),
        ...(code ? (lineArgs ? { code, args: lineArgs } : { code }) : {}),
      };
      this.buffer.push(line);
      this.pending.push(line);
    }

    if (this.buffer.length > BUFFER_LIMIT) {
      const overflow = this.buffer.length - BUFFER_LIMIT;
      this.buffer.splice(0, overflow);
      this.droppedCount += overflow;
    }

    if (this.hasWindow()) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const batch = this.pending;
      this.pending = [];
      if (batch.length === 0) return;
      this.sendToWindow(IPC_EVENTS.consoleLines, batch);
    }, FLUSH_INTERVAL_MS);
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private sendToWindow(channel: string, payload: unknown): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    try {
      window.webContents.send(channel, payload);
    } catch {
      /* renderer torn down between checks — drop the push */
    }
  }
}

export const consoleHub = new ConsoleHub();

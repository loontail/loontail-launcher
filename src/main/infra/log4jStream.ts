// Streaming parser for Minecraft log4j2 XMLLayout output. Events straddle
// chunk boundaries and interleave with plain-text JVM/mod prints, so we buffer
// per-stream and emit a typed sequence of text / event chunks.

import type { ConsoleSources } from '@shared/contracts/console';

const EVENT_OPEN = '<log4j:Event';
const EVENT_CLOSE = '</log4j:Event>';

const ATTR_PATTERNS = {
  logger: /\blogger="([^"]*)"/,
  timestamp: /\btimestamp="([^"]*)"/,
  level: /\blevel="([^"]*)"/,
  thread: /\bthread="([^"]*)"/,
} as const;

const MESSAGE_CDATA = /<log4j:Message>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/log4j:Message>/;
const THROWABLE_CDATA = /<log4j:Throwable>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/log4j:Throwable>/;

export type Log4jStream = typeof ConsoleSources.STDOUT | typeof ConsoleSources.STDERR;

export type Log4jEvent = {
  logger: string;
  timestampMs: number;
  level: string;
  thread: string;
  message: string;
  throwable?: string;
};

export type ParsedChunk = { kind: 'text'; text: string } | { kind: 'event'; event: Log4jEvent };

const parseAttr = (xml: string, pattern: RegExp): string => {
  const match = pattern.exec(xml);
  return match?.[1] ?? '';
};

const parseEvent = (xml: string): Log4jEvent => {
  const messageMatch = MESSAGE_CDATA.exec(xml);
  const throwableMatch = THROWABLE_CDATA.exec(xml);
  const timestampRaw = parseAttr(xml, ATTR_PATTERNS.timestamp);
  const timestampMs = Number.parseInt(timestampRaw, 10);
  return {
    logger: parseAttr(xml, ATTR_PATTERNS.logger),
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now(),
    level: parseAttr(xml, ATTR_PATTERNS.level) || 'INFO',
    thread: parseAttr(xml, ATTR_PATTERNS.thread),
    message: messageMatch?.[1] ?? '',
    ...(throwableMatch?.[1] ? { throwable: throwableMatch[1] } : {}),
  };
};

type StreamState = { buffer: string };

export class Log4jStreamParser {
  private readonly streams: Record<Log4jStream, StreamState> = {
    stdout: { buffer: '' },
    stderr: { buffer: '' },
  };

  feed(stream: Log4jStream, chunk: string): readonly ParsedChunk[] {
    const state = this.streams[stream];
    state.buffer += chunk;
    return this.drain(state, false);
  }

  // Drain remaining buffer; call on session end so a trailing partial event
  // doesn't get silently dropped.
  flush(stream: Log4jStream): readonly ParsedChunk[] {
    const state = this.streams[stream];
    return this.drain(state, true);
  }

  reset(): void {
    this.streams.stdout.buffer = '';
    this.streams.stderr.buffer = '';
  }

  private drain(state: StreamState, isFinal: boolean): readonly ParsedChunk[] {
    const out: ParsedChunk[] = [];
    while (state.buffer.length > 0) {
      const openIndex = state.buffer.indexOf(EVENT_OPEN);
      if (openIndex === -1) {
        // Hold back the trailing suffix only if it's a prefix of EVENT_OPEN
        // (e.g. chunk ends with "<log"); otherwise flush as text.
        if (isFinal) {
          out.push({ kind: 'text', text: state.buffer });
          state.buffer = '';
          return out;
        }
        const lastLt = state.buffer.lastIndexOf('<');
        const couldBeOpenTag =
          lastLt !== -1 &&
          state.buffer.length - lastLt < EVENT_OPEN.length &&
          EVENT_OPEN.startsWith(state.buffer.slice(lastLt));
        if (!couldBeOpenTag) {
          out.push({ kind: 'text', text: state.buffer });
          state.buffer = '';
          return out;
        }
        const flushable = state.buffer.slice(0, lastLt);
        if (flushable.length > 0) {
          out.push({ kind: 'text', text: flushable });
        }
        state.buffer = state.buffer.slice(lastLt);
        return out;
      }
      if (openIndex > 0) {
        out.push({ kind: 'text', text: state.buffer.slice(0, openIndex) });
        state.buffer = state.buffer.slice(openIndex);
      }
      const closeIndex = state.buffer.indexOf(EVENT_CLOSE);
      if (closeIndex === -1) {
        if (isFinal) {
          out.push({ kind: 'text', text: state.buffer });
          state.buffer = '';
        }
        return out;
      }
      const eventEnd = closeIndex + EVENT_CLOSE.length;
      const eventXml = state.buffer.slice(0, eventEnd);
      state.buffer = state.buffer.slice(eventEnd);
      out.push({ kind: 'event', event: parseEvent(eventXml) });
    }
    return out;
  }
}

const LEVEL_MAP: Record<string, 'debug' | 'info' | 'warn' | 'error'> = {
  TRACE: 'debug',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  WARNING: 'warn',
  ERROR: 'error',
  SEVERE: 'error',
  FATAL: 'error',
};

export const mapLog4jLevel = (level: string): 'debug' | 'info' | 'warn' | 'error' =>
  LEVEL_MAP[level.toUpperCase()] ?? 'info';

export const formatLog4jLine = (event: Log4jEvent, line: string): string =>
  event.logger ? `[${event.logger}] ${line}` : line;

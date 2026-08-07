import { formatLog4jLine, Log4jStreamParser, mapLog4jLevel } from '@main/infra/log4jStream';
import { describe, expect, it } from 'vitest';

const SAMPLE_EVENT = `<log4j:Event logger="FabricLoader/Mixin" timestamp="1778966984661" level="INFO" thread="main">
  <log4j:Message><![CDATA[SpongePowered MIXIN Subsystem Version=0.8.7]]></log4j:Message>
</log4j:Event>`;

const SAMPLE_WITH_THROWABLE = `<log4j:Event logger="x" timestamp="1" level="ERROR" thread="t">
  <log4j:Message><![CDATA[Boom]]></log4j:Message>
  <log4j:Throwable><![CDATA[java.lang.RuntimeException: nope
\tat Foo.bar(Foo.java:1)]]></log4j:Throwable>
</log4j:Event>`;

describe('Log4jStreamParser', () => {
  it('parses a complete single event fed in one chunk', () => {
    const parser = new Log4jStreamParser();
    const chunks = parser.feed('stdout', SAMPLE_EVENT);
    expect(chunks).toHaveLength(1);
    const [chunk] = chunks;
    if (chunk?.kind !== 'event') throw new Error('expected event');
    expect(chunk.event).toEqual({
      logger: 'FabricLoader/Mixin',
      timestampMs: 1778966984661,
      level: 'INFO',
      thread: 'main',
      message: 'SpongePowered MIXIN Subsystem Version=0.8.7',
    });
  });

  it('passes through non-XML text as a single text chunk', () => {
    const parser = new Log4jStreamParser();
    const chunks = parser.feed('stdout', 'Picked up _JAVA_OPTIONS: -Xmx2G\nLaunching…\n');
    expect(chunks).toEqual([
      { kind: 'text', text: 'Picked up _JAVA_OPTIONS: -Xmx2G\nLaunching…\n' },
    ]);
  });

  it('emits passthrough text before an event in the same buffer', () => {
    const parser = new Log4jStreamParser();
    const chunks = parser.feed('stdout', `prefix line\n${SAMPLE_EVENT}`);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ kind: 'text', text: 'prefix line\n' });
    expect(chunks[1]?.kind).toBe('event');
  });

  it('handles an event split across two chunks', () => {
    const parser = new Log4jStreamParser();
    const mid = Math.floor(SAMPLE_EVENT.length / 2);
    const first = parser.feed('stdout', SAMPLE_EVENT.slice(0, mid));
    const second = parser.feed('stdout', SAMPLE_EVENT.slice(mid));
    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
    expect(second[0]?.kind).toBe('event');
  });

  it('extracts throwable when present', () => {
    const parser = new Log4jStreamParser();
    const chunks = parser.feed('stdout', SAMPLE_WITH_THROWABLE);
    const [chunk] = chunks;
    if (chunk?.kind !== 'event') throw new Error('expected event');
    expect(chunk.event.throwable).toContain('java.lang.RuntimeException');
  });

  it('keeps stdout and stderr buffers independent', () => {
    const parser = new Log4jStreamParser();
    parser.feed('stdout', '<log4j:Event logger="a" timestamp="1" level="INFO" thread="t">');
    const stderrChunks = parser.feed('stderr', 'plain stderr\n');
    expect(stderrChunks).toEqual([{ kind: 'text', text: 'plain stderr\n' }]);
  });

  it('flushes a trailing partial event as text on final drain', () => {
    const parser = new Log4jStreamParser();
    parser.feed(
      'stdout',
      '<log4j:Event logger="a" timestamp="1" level="INFO" thread="t">incomplete',
    );
    const flushed = parser.flush('stdout');
    expect(flushed).toEqual([
      {
        kind: 'text',
        text: '<log4j:Event logger="a" timestamp="1" level="INFO" thread="t">incomplete',
      },
    ]);
  });

  it('reset clears both buffers', () => {
    const parser = new Log4jStreamParser();
    parser.feed('stdout', '<log4j:Event partial');
    parser.reset();
    expect(parser.flush('stdout')).toEqual([]);
    expect(parser.flush('stderr')).toEqual([]);
  });
});

describe('mapLog4jLevel', () => {
  it('maps known levels case-insensitively', () => {
    expect(mapLog4jLevel('INFO')).toBe('info');
    expect(mapLog4jLevel('warn')).toBe('warn');
    expect(mapLog4jLevel('Severe')).toBe('error');
  });

  it('defaults unknown levels to info', () => {
    expect(mapLog4jLevel('NOPE')).toBe('info');
  });
});

describe('formatLog4jLine', () => {
  it('prepends logger when present', () => {
    expect(
      formatLog4jLine(
        { logger: 'FabricLoader', timestampMs: 0, level: 'INFO', thread: 'main', message: '' },
        'hello',
      ),
    ).toBe('[FabricLoader] hello');
  });

  it('returns bare line when logger is empty', () => {
    expect(
      formatLog4jLine(
        { logger: '', timestampMs: 0, level: 'INFO', thread: 'main', message: '' },
        'hello',
      ),
    ).toBe('hello');
  });
});

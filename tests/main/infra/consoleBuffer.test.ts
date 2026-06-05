import { ConsoleBuffer, type ConsoleLineInput } from '@main/infra/consoleBuffer';
import { ConsoleLevels, ConsoleSources } from '@shared/contracts/console';
import { describe, expect, it } from 'vitest';

const makeInput = (message: string): ConsoleLineInput => ({
  level: ConsoleLevels.INFO,
  source: ConsoleSources.STDOUT,
  message,
});

describe('ConsoleBuffer', () => {
  it('tracks overflow while retaining pending lines for flush', () => {
    const buffer = new ConsoleBuffer({ limit: 3, now: () => 123 });

    buffer.append(['one', 'two', 'three', 'four'].map(makeInput));

    expect(buffer.getLines()).toEqual([
      {
        id: 1,
        timestamp: 123,
        level: ConsoleLevels.INFO,
        source: ConsoleSources.STDOUT,
        message: 'two',
      },
      {
        id: 2,
        timestamp: 123,
        level: ConsoleLevels.INFO,
        source: ConsoleSources.STDOUT,
        message: 'three',
      },
      {
        id: 3,
        timestamp: 123,
        level: ConsoleLevels.INFO,
        source: ConsoleSources.STDOUT,
        message: 'four',
      },
    ]);
    expect(buffer.getDroppedCount()).toBe(1);
    expect(buffer.consumePending().map((line) => line.message)).toEqual(['two', 'three', 'four']);
    expect(buffer.consumePending()).toEqual([]);
  });

  it('keeps consumePending a subset of getLines after overflow across batches', () => {
    const buffer = new ConsoleBuffer({ limit: 3, now: () => 123 });

    buffer.append(['a', 'b', 'c'].map(makeInput));
    buffer.consumePending();
    buffer.append(['d', 'e'].map(makeInput));

    const retainedIds = new Set(buffer.getLines().map((line) => line.id));
    const pending = buffer.consumePending();

    expect(buffer.getLines().map((line) => line.message)).toEqual(['c', 'd', 'e']);
    expect(buffer.getDroppedCount()).toBe(2);
    expect(pending.map((line) => line.message)).toEqual(['d', 'e']);
    for (const line of pending) {
      expect(retainedIds.has(line.id)).toBe(true);
    }
  });

  it('clears retained lines, pending lines, and dropped count', () => {
    const buffer = new ConsoleBuffer({ limit: 2, now: () => 123 });
    buffer.append(['one', 'two', 'three', 'four'].map(makeInput));

    buffer.clear();

    expect(buffer.getLines()).toEqual([]);
    expect(buffer.getDroppedCount()).toBe(0);
    expect(buffer.consumePending()).toEqual([]);
  });

  it('copies retained line messages only', () => {
    const buffer = new ConsoleBuffer({ limit: 2, now: () => 123 });

    buffer.append(['one', 'two', 'three'].map(makeInput));

    expect(buffer.copyAll()).toBe('two\nthree');
  });
});

import { selectRecent } from '@shared/domain/recent';
import { describe, expect, it } from 'vitest';

type Item = { key: string; label: string };

const item = (key: string): Item => ({ key, label: key });

describe('selectRecent', () => {
  it('returns [] for an empty played-at map', () => {
    expect(selectRecent({}, [item('a'), item('b')], 12)).toEqual([]);
  });

  it('sorts matched items by timestamp descending', () => {
    const items = [item('a'), item('b'), item('c')];
    const playedAt = { a: 100, b: 300, c: 200 };
    expect(selectRecent(playedAt, items, 12).map((i) => i.key)).toEqual(['b', 'c', 'a']);
  });

  it('caps the result at limit', () => {
    const items = [item('a'), item('b'), item('c')];
    const playedAt = { a: 100, b: 300, c: 200 };
    expect(selectRecent(playedAt, items, 2).map((i) => i.key)).toEqual(['b', 'c']);
  });

  it('ignores played-at keys with no matching item', () => {
    const items = [item('a')];
    const playedAt = { a: 100, ghost: 999 };
    expect(selectRecent(playedAt, items, 12).map((i) => i.key)).toEqual(['a']);
  });

  it('excludes items that were never played', () => {
    const items = [item('a'), item('b')];
    const playedAt = { a: 100 };
    expect(selectRecent(playedAt, items, 12).map((i) => i.key)).toEqual(['a']);
  });

  it('is stable for equal timestamps (preserves input order)', () => {
    const items = [item('a'), item('b'), item('c')];
    const playedAt = { a: 100, b: 100, c: 100 };
    expect(selectRecent(playedAt, items, 12).map((i) => i.key)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] when limit is zero or negative', () => {
    const items = [item('a'), item('b')];
    const playedAt = { a: 100, b: 200 };
    expect(selectRecent(playedAt, items, 0)).toEqual([]);
    expect(selectRecent(playedAt, items, -1)).toEqual([]);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}));

import { getFolderSize, isPathUnderAllowedRoots } from '@main/infra/system';

const NO_LIMITS = { maxEntries: 500_000, timeoutMs: 30_000 };

let tempRoot = '';

const makeDir = (parent: string, name: string): string => {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync.native(dir);
};

beforeEach(() => {
  tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-launcher-system-')));
  loggerMocks.warn.mockClear();
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('getFolderSize walk bounds', () => {
  const seed = (): string => {
    const root = makeDir(tempRoot, 'tree');
    for (const name of ['a.bin', 'b.bin', 'c.bin']) {
      fs.writeFileSync(path.join(root, name), Buffer.alloc(100));
    }
    fs.writeFileSync(path.join(makeDir(root, 'nested'), 'd.bin'), Buffer.alloc(100));
    return root;
  };

  it('sums every file in the tree when the bounds are not reached', async () => {
    await expect(getFolderSize(seed(), NO_LIMITS)).resolves.toEqual({
      path: expect.any(String),
      bytes: 400,
    });
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('stops on the entry cap and reports a partial total', async () => {
    // Unbounded, a renderer-supplied root (C:\Users) walks the whole subtree and
    // pins the libuv pool for minutes.
    const root = seed();

    await expect(getFolderSize(root, { ...NO_LIMITS, maxEntries: 1 })).resolves.toEqual({
      path: root,
      bytes: 0,
    });
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Folder size walk stopped early; reporting a partial total',
      expect.objectContaining({ reason: 'entry cap' }),
    );
  });

  it('stops on the walk deadline and reports a partial total', async () => {
    const root = seed();

    await expect(getFolderSize(root, { ...NO_LIMITS, timeoutMs: 0 })).resolves.toEqual({
      path: root,
      bytes: 0,
    });
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Folder size walk stopped early; reporting a partial total',
      expect.objectContaining({ reason: 'timeout' }),
    );
  });

  it('reports null for a folder that does not exist', async () => {
    const missing = path.join(tempRoot, 'nope');
    await expect(getFolderSize(missing, NO_LIMITS)).resolves.toEqual({
      path: missing,
      bytes: null,
    });
  });
});

describe('isPathUnderAllowedRoots', () => {
  it('accepts a root itself and any descendant', async () => {
    const root = makeDir(tempRoot, 'root');
    const child = makeDir(root, 'deep/child');

    await expect(isPathUnderAllowedRoots(root, [root])).resolves.toBe(true);
    await expect(isPathUnderAllowedRoots(child, [root])).resolves.toBe(true);
  });

  it('accepts a folder that does not exist yet under an allowed root', async () => {
    const root = makeDir(tempRoot, 'root');

    await expect(
      isPathUnderAllowedRoots(path.join(root, 'about-to-exist', 'nested'), [root]),
    ).resolves.toBe(true);
  });

  it('rejects a sibling, a traversal and an empty path', async () => {
    const root = makeDir(tempRoot, 'root');
    const sibling = makeDir(tempRoot, 'sibling');

    await expect(isPathUnderAllowedRoots(sibling, [root])).resolves.toBe(false);
    await expect(isPathUnderAllowedRoots(path.join(root, '..', 'sibling'), [root])).resolves.toBe(
      false,
    );
    await expect(isPathUnderAllowedRoots('', [root])).resolves.toBe(false);
  });

  it('rejects everything when no root exists on disk', async () => {
    const root = makeDir(tempRoot, 'root');

    await expect(isPathUnderAllowedRoots(root, [path.join(tempRoot, 'missing'), ''])).resolves.toBe(
      false,
    );
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clientFolderHasContent, isAnythingInstalled } from '@main/services/minecraft/runtimeState';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'loontail-runtime-state-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('clientFolderHasContent', () => {
  it('returns false for an empty path', async () => {
    expect(await clientFolderHasContent('')).toBe(false);
  });

  it('returns false for a missing folder', async () => {
    const dir = await makeTempDir();
    expect(await clientFolderHasContent(path.join(dir, 'nope'))).toBe(false);
  });

  it('returns false for an empty folder', async () => {
    const dir = await makeTempDir();
    expect(await clientFolderHasContent(dir)).toBe(false);
  });

  it('returns true for a partial install with no version JSON (only libraries on disk)', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, 'libraries'), { recursive: true });
    // Exactly the broken state where repair must still run.
    expect(await isAnythingInstalled(dir)).toBe(false);
    expect(await clientFolderHasContent(dir)).toBe(true);
  });
});

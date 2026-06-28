import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256File, sha256String } from '@main/services/bundle/hash';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// FIPS 180-2 reference vectors.
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('sha256String', () => {
  it('matches known vectors', () => {
    expect(sha256String('')).toBe(EMPTY);
    expect(sha256String('abc')).toBe(ABC);
  });
});

describe('sha256File', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'bundle-hash-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('hashes file contents to the same digest as the string vector', async () => {
    const file = path.join(dir, 'abc.txt');
    await fs.writeFile(file, 'abc');
    expect(await sha256File(file)).toBe(ABC);
  });

  it('rejects when the file does not exist', async () => {
    await expect(sha256File(path.join(dir, 'missing'))).rejects.toBeInstanceOf(Error);
  });
});

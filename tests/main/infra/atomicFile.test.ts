import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicReplace, readJsonValidated, writeJsonAtomic } from '@main/infra/atomicFile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const Schema = z.object({ name: z.string(), count: z.number() });

describe('writeJsonAtomic', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'atomic-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes pretty JSON to the target', async () => {
    const target = path.join(dir, 'out.json');
    await writeJsonAtomic(target, { name: 'a', count: 1 });
    const raw = await fs.readFile(target, 'utf8');
    expect(JSON.parse(raw)).toEqual({ name: 'a', count: 1 });
    // Pretty-printed (2-space indent) so the on-disk shape is unchanged.
    expect(raw).toContain('\n  "name"');
  });

  it('creates missing parent directories', async () => {
    const target = path.join(dir, 'nested', 'deep', 'out.json');
    await writeJsonAtomic(target, { name: 'a', count: 1 });
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ name: 'a', count: 1 });
  });

  it('overwrites an existing target atomically', async () => {
    const target = path.join(dir, 'out.json');
    await writeJsonAtomic(target, { name: 'old', count: 1 });
    await writeJsonAtomic(target, { name: 'new', count: 2 });
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ name: 'new', count: 2 });
  });

  it('leaves no stray tmp file behind on success', async () => {
    const target = path.join(dir, 'out.json');
    await writeJsonAtomic(target, { name: 'a', count: 1 });
    expect(
      await fs
        .access(`${target}.tmp`)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });
});

describe('readJsonValidated', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'atomic-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips a value written by writeJsonAtomic', async () => {
    const target = path.join(dir, 'out.json');
    await writeJsonAtomic(target, { name: 'a', count: 1 });
    expect(await readJsonValidated(target, Schema)).toEqual({ name: 'a', count: 1 });
  });

  it('returns null and stays silent for a missing file', async () => {
    const onReadError = vi.fn();
    const onInvalid = vi.fn();
    const result = await readJsonValidated(path.join(dir, 'absent.json'), Schema, {
      onReadError,
      onInvalid,
    });
    expect(result).toBeNull();
    expect(onReadError).not.toHaveBeenCalled();
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('returns null and calls onReadError for unparseable JSON', async () => {
    // JSON.parse throws inside the read try, so it lands on the read-error path
    // (matching the prior hand-rolled readers' catch blocks), not onInvalid.
    const target = path.join(dir, 'bad.json');
    await fs.writeFile(target, '{not json');
    const onReadError = vi.fn();
    const onInvalid = vi.fn();
    expect(await readJsonValidated(target, Schema, { onReadError, onInvalid })).toBeNull();
    expect(onReadError).toHaveBeenCalledTimes(1);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it('returns null and calls onInvalid for schema-invalid JSON', async () => {
    const target = path.join(dir, 'invalid.json');
    await fs.writeFile(target, JSON.stringify({ name: 'a', count: 'nope' }));
    const onInvalid = vi.fn();
    expect(await readJsonValidated(target, Schema, { onInvalid })).toBeNull();
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });
});

describe('atomicReplace', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'atomic-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('moves a tmp file onto the destination', async () => {
    const tmp = path.join(dir, 'x.tmp');
    const dest = path.join(dir, 'x');
    await fs.writeFile(tmp, 'payload');
    await atomicReplace(tmp, dest);
    expect(await fs.readFile(dest, 'utf8')).toBe('payload');
    expect(
      await fs
        .access(tmp)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });
});

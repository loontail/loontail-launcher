import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpUserData = vi.hoisted(() => {
  // Inline requires — vi.hoisted runs before any module-level import resolves.
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'mc-launcher-cache-test-'));
});

vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData },
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import fs from 'node:fs';
import path from 'node:path';
import {
  cachedFetch,
  enforceSizeBound,
  getNamespaceSize,
  readBuffer,
  writeBuffer,
} from '@main/infra/cache';
import { HttpError } from '@main/infra/http';

const NAMESPACE = 'test/namespace';
const KEY = 'entry-1';

const namespaceDir = (): string => path.join(tmpUserData, 'cache', NAMESPACE);

beforeEach(() => {
  fs.rmSync(namespaceDir(), { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

describe('cachedFetch', () => {
  it('persists fetcher result to disk and returns it on success', async () => {
    const fetcher = vi.fn().mockResolvedValue({ hello: 'world' });

    const value = await cachedFetch({ namespace: NAMESPACE, key: KEY, fetcher });

    expect(value).toEqual({ hello: 'world' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const onDisk = await readBuffer(NAMESPACE, KEY);
    expect(onDisk).not.toBeNull();
    expect(JSON.parse(onDisk?.toString('utf8') ?? '')).toEqual({ hello: 'world' });
  });

  it('falls back to disk on a network error when a snapshot exists', async () => {
    await writeBuffer(NAMESPACE, KEY, Buffer.from(JSON.stringify({ from: 'disk' }), 'utf8'));
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const value = await cachedFetch({ namespace: NAMESPACE, key: KEY, fetcher });

    expect(value).toEqual({ from: 'disk' });
  });

  it('rethrows when offline and no disk snapshot exists', async () => {
    const networkError = new TypeError('fetch failed');
    const fetcher = vi.fn().mockRejectedValue(networkError);

    await expect(cachedFetch({ namespace: NAMESPACE, key: KEY, fetcher })).rejects.toBe(
      networkError,
    );
  });

  it('treats HttpError 5xx as offline', async () => {
    await writeBuffer(NAMESPACE, KEY, Buffer.from(JSON.stringify({ from: 'disk' }), 'utf8'));
    const fetcher = vi.fn().mockRejectedValue(new HttpError(503, 'Service Unavailable'));

    const value = await cachedFetch({ namespace: NAMESPACE, key: KEY, fetcher });

    expect(value).toEqual({ from: 'disk' });
  });

  it('rethrows HttpError 4xx without consulting disk', async () => {
    await writeBuffer(NAMESPACE, KEY, Buffer.from(JSON.stringify({ from: 'disk' }), 'utf8'));
    const httpError = new HttpError(404, 'Not Found');
    const fetcher = vi.fn().mockRejectedValue(httpError);

    await expect(cachedFetch({ namespace: NAMESPACE, key: KEY, fetcher })).rejects.toBe(httpError);
  });

  it('respects a custom isOfflineError predicate', async () => {
    await writeBuffer(NAMESPACE, KEY, Buffer.from(JSON.stringify({ from: 'disk' }), 'utf8'));
    const httpError = new HttpError(404, 'Not Found');
    const fetcher = vi.fn().mockRejectedValue(httpError);

    const value = await cachedFetch({
      namespace: NAMESPACE,
      key: KEY,
      fetcher,
      isOfflineError: () => true,
    });

    expect(value).toEqual({ from: 'disk' });
  });

  it('rethrows the fetcher error when the on-disk snapshot is corrupt JSON', async () => {
    await writeBuffer(NAMESPACE, KEY, Buffer.from('{not valid json', 'utf8'));
    const networkError = new TypeError('fetch failed');
    const fetcher = vi.fn().mockRejectedValue(networkError);

    await expect(cachedFetch({ namespace: NAMESPACE, key: KEY, fetcher })).rejects.toBe(
      networkError,
    );
  });

  // A snapshot outlives the release that wrote it and sits in a user-writable file,
  // so well-formed JSON of the wrong shape used to be cast to T and blow up in the
  // caller instead of here.
  it('rethrows the fetcher error when the snapshot fails parseSnapshot', async () => {
    await writeBuffer(NAMESPACE, KEY, Buffer.from(JSON.stringify({ clients: [] }), 'utf8'));
    const networkError = new TypeError('fetch failed');
    const fetcher = vi.fn().mockRejectedValue(networkError);
    const parseSnapshot = vi.fn((value: unknown) => (Array.isArray(value) ? value : null));

    await expect(
      cachedFetch({ namespace: NAMESPACE, key: KEY, fetcher, parseSnapshot }),
    ).rejects.toBe(networkError);
    expect(parseSnapshot).toHaveBeenCalledWith({ clients: [] });
  });

  it('serves a snapshot that passes parseSnapshot', async () => {
    await writeBuffer(NAMESPACE, KEY, Buffer.from(JSON.stringify([{ key: 'a' }]), 'utf8'));
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const result = await cachedFetch({
      namespace: NAMESPACE,
      key: KEY,
      fetcher,
      parseSnapshot: (value: unknown) => (Array.isArray(value) ? value : null),
    });

    expect(result).toEqual([{ key: 'a' }]);
  });
});

describe('enforceSizeBound', () => {
  const writeWithMtime = async (key: string, size: number, mtime: Date): Promise<void> => {
    await writeBuffer(NAMESPACE, key, Buffer.alloc(size, 1));
    const file = path.join(namespaceDir(), Buffer.from(key, 'utf8').toString('base64url'));
    fs.utimesSync(file, mtime, mtime);
  };

  it('no-ops when the namespace fits under the bound', async () => {
    await writeWithMtime('a', 100, new Date(1000));
    await writeWithMtime('b', 100, new Date(2000));

    await enforceSizeBound(NAMESPACE, 1024);

    expect(await getNamespaceSize(NAMESPACE)).toBe(200);
  });

  it('prunes oldest entries by mtime until the total fits under the bound', async () => {
    await writeWithMtime('old', 400, new Date(1000));
    await writeWithMtime('mid', 400, new Date(2000));
    await writeWithMtime('new', 400, new Date(3000));

    await enforceSizeBound(NAMESPACE, 500);

    expect(await readBuffer(NAMESPACE, 'old')).toBeNull();
    expect(await readBuffer(NAMESPACE, 'mid')).toBeNull();
    expect(await readBuffer(NAMESPACE, 'new')).not.toBeNull();
    expect(await getNamespaceSize(NAMESPACE)).toBeLessThanOrEqual(500);
  });

  it('silently returns when the namespace does not exist yet', async () => {
    await expect(enforceSizeBound('does/not/exist', 1024)).resolves.toBeUndefined();
  });

  it('evicts a companion sidecar together with its body, never on its own', async () => {
    // A body without its sidecar renders as application/octet-stream and a
    // sidecar without a body is dead weight, so the pair must live and die
    // together (LM-17).
    await writeWithMtime('old', 400, new Date(1000));
    await writeWithMtime('old.type', 20, new Date(1000));
    await writeWithMtime('new', 400, new Date(3000));
    await writeWithMtime('new.type', 20, new Date(500));

    await enforceSizeBound(NAMESPACE, 500, { companionSuffix: '.type' });

    expect(await readBuffer(NAMESPACE, 'old')).toBeNull();
    expect(await readBuffer(NAMESPACE, 'old.type')).toBeNull();
    expect(await readBuffer(NAMESPACE, 'new')).not.toBeNull();
    // The surviving body keeps its sidecar even though the sidecar is the oldest
    // file in the namespace.
    expect(await readBuffer(NAMESPACE, 'new.type')).not.toBeNull();
  });

  it('drops an orphan sidecar even when the namespace fits under the bound', async () => {
    await writeWithMtime('kept', 100, new Date(1000));
    await writeWithMtime('kept.type', 20, new Date(1000));
    await writeWithMtime('vanished.type', 20, new Date(1000));

    await enforceSizeBound(NAMESPACE, 1024, { companionSuffix: '.type' });

    expect(await readBuffer(NAMESPACE, 'vanished.type')).toBeNull();
    expect(await readBuffer(NAMESPACE, 'kept')).not.toBeNull();
    expect(await readBuffer(NAMESPACE, 'kept.type')).not.toBeNull();
  });

  it('keeps a just-written sidecar whose body is still being written', async () => {
    // A body and its sidecar are two separate fs operations, so a pass triggered by
    // another entry can observe the sidecar first; deleting it left the body with no
    // metadata (wrong Content-Type, and nothing ever revalidates it).
    await writeBuffer(NAMESPACE, 'in-flight.type', Buffer.alloc(20, 1));

    await enforceSizeBound(NAMESPACE, 1024, { companionSuffix: '.type' });

    expect(await readBuffer(NAMESPACE, 'in-flight.type')).not.toBeNull();
  });

  it('still drops a young orphan once the write can no longer be in flight', async () => {
    await writeWithMtime('gone.type', 20, new Date(Date.now() - 5 * 60_000));

    await enforceSizeBound(NAMESPACE, 1024, { companionSuffix: '.type' });

    expect(await readBuffer(NAMESPACE, 'gone.type')).toBeNull();
  });
});

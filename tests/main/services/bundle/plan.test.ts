import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BundleError } from '@main/services/bundle/errors';
import { buildPlan } from '@main/services/bundle/plan';
import type { LocalManifest, RemoteManifest } from '@shared/contracts/bundle';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { asBundleSlug } from '@shared/contracts/ids';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const remote = (
  entries: Array<{ path: string; content?: string; downloadOnce?: boolean }>,
): RemoteManifest => {
  const root = entries.map((e) => ({
    path: e.path,
    name: path.basename(e.path),
    size: e.content ? Buffer.byteLength(e.content) : 0,
    isDir: false,
    ...(e.content ? { sha256: sha256(e.content) } : {}),
    url: `http://example.test/${e.path}`,
    ...(e.downloadOnce ? { downloadOnce: true } : {}),
  }));
  return { root };
};

describe('buildPlan', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'bundle-plan-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('schedules a fresh download when local manifest is empty', async () => {
    const remoteManifest = remote([{ path: 'mods/foo.jar', content: 'foo' }]);
    const plan = await buildPlan(remoteManifest, null, dir);
    expect(plan.toDownload).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.bytesTotal).toBe(3);
  });

  it('skips file when local manifest sha matches and file exists', async () => {
    const remoteManifest = remote([{ path: 'mods/foo.jar', content: 'foo' }]);
    await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
    await fs.writeFile(path.join(dir, 'mods/foo.jar'), 'foo');
    const local: LocalManifest = {
      bundleSlug: asBundleSlug('b'),
      manifestHash: 'h',
      syncedAt: '2024-01-01',
      files: { 'mods/foo.jar': { sha256: sha256('foo'), size: 3 } },
    };
    const plan = await buildPlan(remoteManifest, local, dir);
    expect(plan.toSkip).toHaveLength(1);
    expect(plan.toDownload).toHaveLength(0);
  });

  it('schedules update when local manifest sha differs', async () => {
    const remoteManifest = remote([{ path: 'mods/foo.jar', content: 'new' }]);
    await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
    await fs.writeFile(path.join(dir, 'mods/foo.jar'), 'old');
    const local: LocalManifest = {
      bundleSlug: asBundleSlug('b'),
      manifestHash: 'h',
      syncedAt: '2024-01-01',
      files: { 'mods/foo.jar': { sha256: sha256('old'), size: 3 } },
    };
    const plan = await buildPlan(remoteManifest, local, dir);
    expect(plan.toUpdate.concat(plan.toDownload)).toHaveLength(1);
  });

  it('non-force: no local record but matching disk content falls through to disk hash and skips', async () => {
    const remoteManifest = remote([{ path: 'mods/foo.jar', content: 'foo' }]);
    await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
    await fs.writeFile(path.join(dir, 'mods/foo.jar'), 'foo');
    const local: LocalManifest = {
      bundleSlug: asBundleSlug('b'),
      manifestHash: 'h',
      syncedAt: '2024-01-01',
      files: { 'mods/unrelated.jar': { sha256: sha256('unrelated'), size: 9 } },
    };
    const plan = await buildPlan(remoteManifest, local, dir);
    expect(plan.toSkip.map((e) => e.path)).toEqual(['mods/foo.jar']);
    expect(plan.toDownload).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('non-force: no local record and differing disk content falls through to disk hash and updates', async () => {
    const remoteManifest = remote([{ path: 'mods/foo.jar', content: 'foo' }]);
    await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
    await fs.writeFile(path.join(dir, 'mods/foo.jar'), 'stale');
    const local: LocalManifest = {
      bundleSlug: asBundleSlug('b'),
      manifestHash: 'h',
      syncedAt: '2024-01-01',
      files: { 'mods/unrelated.jar': { sha256: sha256('unrelated'), size: 9 } },
    };
    const plan = await buildPlan(remoteManifest, local, dir);
    expect(plan.toUpdate.map((e) => e.path)).toEqual(['mods/foo.jar']);
    expect(plan.toDownload).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
  });

  it('lists local-only files in toDelete', async () => {
    const remoteManifest = remote([{ path: 'mods/foo.jar', content: 'foo' }]);
    const local: LocalManifest = {
      bundleSlug: asBundleSlug('b'),
      manifestHash: 'h',
      syncedAt: '2024-01-01',
      files: {
        'mods/foo.jar': { sha256: sha256('foo'), size: 3 },
        'mods/old.jar': { sha256: sha256('old'), size: 3 },
      },
    };
    await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
    await fs.writeFile(path.join(dir, 'mods/foo.jar'), 'foo');
    const plan = await buildPlan(remoteManifest, local, dir);
    expect(plan.toDelete).toContain('mods/old.jar');
    expect(plan.toSkip).toHaveLength(1);
  });

  it('downloadOnce skipped when file already exists, downloaded otherwise', async () => {
    const remoteManifest = remote([
      { path: 'one.exe', content: 'one', downloadOnce: true },
      { path: 'two.exe', content: 'two', downloadOnce: true },
    ]);
    await fs.writeFile(path.join(dir, 'one.exe'), 'whatever');
    const plan = await buildPlan(remoteManifest, null, dir);
    expect(plan.toSkip.map((e) => e.path)).toEqual(['one.exe']);
    expect(plan.toDownload.map((e) => e.path)).toEqual(['two.exe']);
  });

  it('force mode re-hashes disk instead of trusting local manifest', async () => {
    const remoteManifest = remote([{ path: 'mods/foo.jar', content: 'foo' }]);
    await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
    await fs.writeFile(path.join(dir, 'mods/foo.jar'), 'tampered');
    const local: LocalManifest = {
      bundleSlug: asBundleSlug('b'),
      manifestHash: 'h',
      syncedAt: '2024-01-01',
      files: { 'mods/foo.jar': { sha256: sha256('foo'), size: 3 } },
    };
    const plan = await buildPlan(remoteManifest, local, dir, { force: true });
    // Forced re-hash sees tampered content → update.
    expect(plan.toUpdate.map((e) => e.path)).toEqual(['mods/foo.jar']);
  });

  it('exposes bundle-owned paths for the healer', async () => {
    const remoteManifest = remote([
      { path: 'libraries/bundle-patch.jar', content: 'p' },
      { path: 'mods/foo.jar', content: 'f' },
    ]);
    const plan = await buildPlan(remoteManifest, null, dir);
    expect(plan.bundleOwnedRelativePaths.has('libraries/bundle-patch.jar')).toBe(true);
    expect(plan.bundleOwnedRelativePaths.has('mods/foo.jar')).toBe(true);
  });

  it('throws ABORTED when the signal is already aborted before planning', async () => {
    const remoteManifest = remote([{ path: 'mods/foo.jar', content: 'foo' }]);
    const controller = new AbortController();
    controller.abort();
    const rejection = buildPlan(remoteManifest, null, dir, { signal: controller.signal });
    await expect(rejection).rejects.toBeInstanceOf(BundleError);
    await expect(rejection).rejects.toMatchObject({ code: BundleErrorCodes.ABORTED });
  });

  it('classifies a large entry set with bounded concurrency without losing any', async () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      path: `mods/file-${i}.jar`,
      content: `content-${i}`,
    }));
    const remoteManifest = remote(entries);
    // First 25 already on disk with matching content → skip; rest absent → download.
    await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
    const local: LocalManifest = {
      bundleSlug: asBundleSlug('b'),
      manifestHash: 'h',
      syncedAt: '2024-01-01',
      files: {},
    };
    for (let i = 0; i < 25; i++) {
      const content = `content-${i}`;
      await fs.writeFile(path.join(dir, `mods/file-${i}.jar`), content);
      local.files[`mods/file-${i}.jar`] = { sha256: sha256(content), size: content.length };
    }
    const plan = await buildPlan(remoteManifest, local, dir);
    expect(plan.toSkip).toHaveLength(25);
    expect(plan.toDownload).toHaveLength(25);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSkip.length + plan.toDownload.length + plan.toUpdate.length).toBe(50);
    // Buckets keep input order.
    expect(plan.toSkip.map((e) => e.path)).toEqual(entries.slice(0, 25).map((e) => e.path));
    expect(plan.toDownload.map((e) => e.path)).toEqual(entries.slice(25).map((e) => e.path));
  });

  describe('Windows path-case drift (BUG-4)', () => {
    const realPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    });

    it('does NOT queue a local file for deletion when the remote re-emits it with different casing', async () => {
      // Remote names the file `Mods/Foo.jar`; the prior local manifest recorded
      // `mods/foo.jar`. On a case-insensitive filesystem these are the same file,
      // so it must not be queued for deletion.
      const remoteManifest = remote([{ path: 'Mods/Foo.jar', content: 'foo' }]);
      await fs.mkdir(path.join(dir, 'mods'), { recursive: true });
      await fs.writeFile(path.join(dir, 'mods/foo.jar'), 'foo');
      const local: LocalManifest = {
        bundleSlug: asBundleSlug('b'),
        manifestHash: 'h',
        syncedAt: '2024-01-01',
        files: { 'mods/foo.jar': { sha256: sha256('foo'), size: 3 } },
      };

      const plan = await buildPlan(remoteManifest, local, dir);

      expect(plan.toDelete).toHaveLength(0);
    });

    it('matches the local manifest fast-path across casing drift so the file is skipped, not re-downloaded', async () => {
      const remoteManifest = remote([{ path: 'Mods/Foo.jar', content: 'foo' }]);
      await fs.mkdir(path.join(dir, 'Mods'), { recursive: true });
      await fs.writeFile(path.join(dir, 'Mods/Foo.jar'), 'foo');
      const local: LocalManifest = {
        bundleSlug: asBundleSlug('b'),
        manifestHash: 'h',
        syncedAt: '2024-01-01',
        files: { 'mods/foo.jar': { sha256: sha256('foo'), size: 3 } },
      };

      const plan = await buildPlan(remoteManifest, local, dir);

      expect(plan.toSkip.map((e) => e.path)).toEqual(['Mods/Foo.jar']);
      expect(plan.toDownload).toHaveLength(0);
      expect(plan.toUpdate).toHaveLength(0);
    });
  });
});

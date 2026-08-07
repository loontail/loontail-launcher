import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DownloadCategories,
  InstallActionKinds,
  type InstallPlan,
  Loaders,
  type MinecraftKit,
  type Target,
} from '@loontail/minecraft-kit';
import {
  createForgeProcessorCache,
  type ForgeProcessorCache,
  repairMissingForgeProcessorOutputs,
} from '@main/services/minecraft/forgeProcessorHealing';
import { asCatalogKey } from '@shared/contracts/ids';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = asCatalogKey('official:forge-client');
const OUTPUT_CONTENT = 'processor-output';

let tempRoot = '';
let cache: ForgeProcessorCache;

const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex');

const target = (): Target =>
  ({
    id: 'forge-client',
    directory: tempRoot,
    minecraft: { version: '1.20.1' },
    loader: {
      type: Loaders.FORGE,
      minecraftVersion: '1.20.1',
      forgeVersion: '47.2.0',
      fullVersion: '1.20.1-47.2.0',
      installerUrl: 'https://files.test.invalid/forge-installer.jar',
    },
    runtime: {
      component: 'java-runtime-gamma',
      manifestSha1: 'runtime-manifest-sha1',
      platformKey: 'windows-x64',
    },
  }) as Target;

const processorPlan = (processorOutput: string): InstallPlan => ({
  targetId: 'forge-client',
  directory: tempRoot,
  target: target(),
  actions: [
    {
      kind: InstallActionKinds.DOWNLOAD_FILE,
      url: 'https://files.test.invalid/forge.jar',
      target: path.join(tempRoot, 'libraries', 'forge.jar'),
      expectedSize: 100,
      category: DownloadCategories.FORGE_LIBRARY,
    },
    {
      kind: InstallActionKinds.RUN_FORGE_PROCESSOR,
      index: 0,
      classpath: [path.join(tempRoot, 'libraries', 'forge.jar')],
      args: [],
      outputs: { [processorOutput]: sha1(OUTPUT_CONTENT) },
    },
  ],
  totalBytes: 100,
  totalActions: 2,
});

beforeEach(async () => {
  cache = createForgeProcessorCache();
  tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'forge-healing-'));
});

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  }
});

describe('createForgeProcessorCache eviction', () => {
  const targetIn = (directory: string): Target => ({ ...target(), directory }) as Target;

  const planIn = (directory: string): InstallPlan => {
    const base = processorPlan(path.join(directory, 'versions', 'forge', 'processed.jar'));
    return { ...base, directory, target: targetIn(directory) };
  };

  it('evicts only the uninstalled directory and leaves other clients warm', () => {
    const other = path.join(tempRoot, '..', 'other-client');
    cache.remember(planIn(tempRoot));
    cache.remember(planIn(other));

    cache.evictByDirectory(tempRoot);

    expect(cache.get(targetIn(tempRoot))).toBeUndefined();
    expect(cache.get(targetIn(other))?.length).toBe(1);
  });

  it('matches the uninstalled directory the way the platform compares paths', () => {
    cache.remember(planIn(tempRoot));

    cache.evictByDirectory(tempRoot.toUpperCase());

    // Windows paths are case-insensitive, so an upper-cased folder is the same
    // entry; a case-sensitive filesystem must keep it.
    const expected = process.platform === 'win32' ? undefined : expect.any(Array);
    expect(cache.get(targetIn(tempRoot))).toEqual(expected);
  });

  it('ignores an empty directory instead of wiping the map', () => {
    cache.remember(planIn(tempRoot));

    cache.evictByDirectory('');

    expect(cache.get(targetIn(tempRoot))?.length).toBe(1);
  });
});

describe('repairMissingForgeProcessorOutputs', () => {
  it('skips full replanning when cached processor outputs are clean', async () => {
    const processorOutput = path.join(tempRoot, 'versions', 'forge', 'processed.jar');
    await fs.mkdir(path.dirname(processorOutput), { recursive: true });
    await fs.writeFile(processorOutput, OUTPUT_CONTENT, 'utf8');
    cache.remember(processorPlan(processorOutput));
    const kit = {
      install: {
        plan: vi.fn(),
      },
    } as unknown as MinecraftKit;

    await expect(repairMissingForgeProcessorOutputs(kit, KEY, target(), cache)).resolves.toEqual({
      ranProcessors: false,
      reranCount: 0,
    });

    expect(kit.install.plan).not.toHaveBeenCalled();
  });

  it('replans and runs the focused repair when cached processor outputs are broken', async () => {
    const processorOutput = path.join(tempRoot, 'versions', 'forge', 'processed.jar');
    await fs.mkdir(path.dirname(processorOutput), { recursive: true });
    await fs.writeFile(processorOutput, 'broken-output', 'utf8');
    const plan = processorPlan(processorOutput);
    cache.remember(plan);
    const runPlan = vi.fn();
    const kit = {
      install: {
        plan: vi.fn(async () => plan),
      },
    } as unknown as MinecraftKit;

    await expect(
      repairMissingForgeProcessorOutputs(kit, KEY, target(), cache, { runPlan }),
    ).resolves.toEqual({
      ranProcessors: true,
      reranCount: 1,
    });

    expect(kit.install.plan).toHaveBeenCalledWith(target(), undefined);
    expect(runPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        totalActions: 2,
        totalBytes: 100,
      }),
    );
  });

  it('carries the plan byte total into the focused repair plan', async () => {
    const processorOutput = path.join(tempRoot, 'versions', 'forge', 'processed.jar');
    await fs.mkdir(path.dirname(processorOutput), { recursive: true });
    await fs.writeFile(processorOutput, 'broken-output', 'utf8');
    const plan = processorPlan(processorOutput);
    // Kit can account for bytes beyond the sum of DOWNLOAD_FILE expectedSize
    // (e.g. extract/write work). The focused plan must preserve that total
    // rather than recomputing a download-only undercount (here 100).
    const planWithExtraBytes: InstallPlan = { ...plan, totalBytes: 250 };
    const runPlan = vi.fn();
    const kit = {
      install: {
        plan: vi.fn(async () => planWithExtraBytes),
      },
    } as unknown as MinecraftKit;

    await repairMissingForgeProcessorOutputs(kit, KEY, target(), cache, { runPlan });

    expect(runPlan).toHaveBeenCalledWith(expect.objectContaining({ totalBytes: 250 }));
  });

  it('honors an aborted signal while checking processor outputs', async () => {
    const processorOutput = path.join(tempRoot, 'versions', 'forge', 'processed.jar');
    await fs.mkdir(path.dirname(processorOutput), { recursive: true });
    await fs.writeFile(processorOutput, OUTPUT_CONTENT, 'utf8');
    cache.remember(processorPlan(processorOutput));
    const controller = new AbortController();
    controller.abort();
    const kit = {
      install: {
        plan: vi.fn(),
      },
    } as unknown as MinecraftKit;

    await expect(
      repairMissingForgeProcessorOutputs(kit, KEY, target(), cache, {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(kit.install.plan).not.toHaveBeenCalled();
  });

  it('replans after evictByDirectory drops the clean cached entry', async () => {
    const processorOutput = path.join(tempRoot, 'versions', 'forge', 'processed.jar');
    await fs.mkdir(path.dirname(processorOutput), { recursive: true });
    await fs.writeFile(processorOutput, OUTPUT_CONTENT, 'utf8');
    const plan = processorPlan(processorOutput);
    cache.remember(plan);
    cache.evictByDirectory(tempRoot);
    const kit = {
      install: {
        plan: vi.fn(async () => plan),
      },
    } as unknown as MinecraftKit;

    await expect(repairMissingForgeProcessorOutputs(kit, KEY, target(), cache)).resolves.toEqual({
      ranProcessors: false,
      reranCount: 0,
    });

    expect(kit.install.plan).toHaveBeenCalledWith(target(), undefined);
  });
});

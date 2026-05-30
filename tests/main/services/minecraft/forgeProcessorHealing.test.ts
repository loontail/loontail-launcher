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
  type ForgeProcessorCache,
  createForgeProcessorCache,
  repairMissingForgeProcessorOutputs,
} from '@main/services/minecraft/forgeProcessorHealing';
import { asClientSlug } from '@shared/contracts/ids';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SLUG = asClientSlug('forge-client');
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

    await expect(repairMissingForgeProcessorOutputs(kit, SLUG, target(), cache)).resolves.toEqual({
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
      repairMissingForgeProcessorOutputs(kit, SLUG, target(), cache, { runPlan }),
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

  it('replans after clear() drops the clean cached entry', async () => {
    const processorOutput = path.join(tempRoot, 'versions', 'forge', 'processed.jar');
    await fs.mkdir(path.dirname(processorOutput), { recursive: true });
    await fs.writeFile(processorOutput, OUTPUT_CONTENT, 'utf8');
    const plan = processorPlan(processorOutput);
    cache.remember(plan);
    cache.clear();
    const kit = {
      install: {
        plan: vi.fn(async () => plan),
      },
    } as unknown as MinecraftKit;

    await expect(repairMissingForgeProcessorOutputs(kit, SLUG, target(), cache)).resolves.toEqual({
      ranProcessors: false,
      reranCount: 0,
    });

    expect(kit.install.plan).toHaveBeenCalledWith(target(), undefined);
  });
});

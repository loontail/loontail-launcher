import {
  Loaders,
  type MinecraftKit,
  type Target,
  VerificationKinds,
  type VerificationResult,
} from '@loontail/minecraft-kit';
import {
  InstallReadinessStates,
  RuntimeVerificationCacheModes,
  clearRuntimeVerificationCache,
  getTargetInstallState,
  invalidateRuntimeVerification,
  isTargetReady,
} from '@main/services/minecraft/runtimeState';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const target = (
  loaderType: Target['loader']['type'] = Loaders.VANILLA,
  patch: Partial<Target> = {},
): Target =>
  ({
    id: 'test-target',
    directory: 'Z:/clients/test-target',
    minecraft: { version: '1.20.1' },
    loader: { type: loaderType },
    runtime: {
      component: 'java-runtime-gamma',
      manifestSha1: 'runtime-manifest-sha1',
      platformKey: 'windows-x64',
      installRoot: 'Z:/shared-runtimes',
    },
    ...patch,
  }) as Target;

const verification = (kind: VerificationResult['kind'], isValid: boolean): VerificationResult => ({
  targetId: 'test-target',
  kind,
  isValid,
  issues: [],
  checkedFiles: 0,
  durationMs: 0,
});

type TargetReadinessReport = {
  readonly targetId: string;
  readonly isReady: boolean;
  readonly verifications: readonly VerificationResult[];
  readonly issues: readonly [];
  readonly durationMs: number;
};

const readiness = (verifications: readonly VerificationResult[]): TargetReadinessReport => ({
  targetId: 'test-target',
  isReady: verifications.every((result) => result.isValid),
  verifications,
  issues: [],
  durationMs: 0,
});

beforeEach(() => {
  clearRuntimeVerificationCache();
});

describe('isTargetReady', () => {
  it('uses the aggregate kit readiness API when cache bypass is requested', async () => {
    const targetReady = vi
      .fn()
      .mockResolvedValue(readiness([verification(VerificationKinds.MINECRAFT, false)]));
    const minecraft = vi.fn();
    const kit = {
      verify: {
        targetReady: { run: targetReady },
        minecraft: { run: minecraft },
      },
    } as unknown as MinecraftKit;

    await expect(
      isTargetReady(kit, target(), {
        runtimeVerificationCache: RuntimeVerificationCacheModes.BYPASS,
      }),
    ).resolves.toBe(false);
    expect(targetReady).toHaveBeenCalledWith(target());
    expect(minecraft).not.toHaveBeenCalled();
  });

  it('falls back to minecraft and runtime verification for older kit versions', async () => {
    const minecraft = vi.fn().mockResolvedValue(verification(VerificationKinds.MINECRAFT, true));
    const runtime = vi.fn().mockResolvedValue(verification(VerificationKinds.RUNTIME, false));
    const kit = {
      verify: {
        minecraft: { run: minecraft },
        runtime: { run: runtime },
      },
    } as unknown as MinecraftKit;

    await expect(isTargetReady(kit, target())).resolves.toBe(false);
    expect(minecraft).toHaveBeenCalledWith(target());
    expect(runtime).toHaveBeenCalledWith(target());
  });

  it('includes the active loader aspect in fallback verification', async () => {
    const minecraft = vi.fn().mockResolvedValue(verification(VerificationKinds.MINECRAFT, true));
    const runtime = vi.fn().mockResolvedValue(verification(VerificationKinds.RUNTIME, true));
    const fabric = vi.fn().mockResolvedValue(verification(VerificationKinds.FABRIC, false));
    const fabricTarget = target(Loaders.FABRIC);
    const kit = {
      verify: {
        minecraft: { run: minecraft },
        runtime: { run: runtime },
        fabric: { run: fabric },
      },
    } as unknown as MinecraftKit;

    await expect(isTargetReady(kit, fabricTarget)).resolves.toBe(false);
    expect(fabric).toHaveBeenCalledWith(fabricTarget);
  });

  it('caches runtime verification across targets sharing the same runtime', async () => {
    const minecraft = vi.fn().mockResolvedValue(verification(VerificationKinds.MINECRAFT, true));
    const runtime = vi.fn().mockResolvedValue(verification(VerificationKinds.RUNTIME, true));
    const kit = {
      verify: {
        minecraft: { run: minecraft },
        runtime: { run: runtime },
      },
    } as unknown as MinecraftKit;
    const firstTarget = target(Loaders.VANILLA, { id: 'first', directory: 'Z:/clients/first' });
    const secondTarget = target(Loaders.VANILLA, { id: 'second', directory: 'Z:/clients/second' });

    await expect(isTargetReady(kit, firstTarget)).resolves.toBe(true);
    await expect(isTargetReady(kit, secondTarget)).resolves.toBe(true);

    expect(minecraft).toHaveBeenCalledTimes(2);
    expect(runtime).toHaveBeenCalledTimes(1);
  });

  it('bypasses cached runtime verification when requested', async () => {
    const minecraft = vi.fn().mockResolvedValue(verification(VerificationKinds.MINECRAFT, true));
    const runtime = vi.fn().mockResolvedValue(verification(VerificationKinds.RUNTIME, true));
    const kit = {
      verify: {
        minecraft: { run: minecraft },
        runtime: { run: runtime },
      },
    } as unknown as MinecraftKit;

    await expect(isTargetReady(kit, target())).resolves.toBe(true);
    await expect(
      isTargetReady(kit, target(), {
        runtimeVerificationCache: RuntimeVerificationCacheModes.BYPASS,
      }),
    ).resolves.toBe(true);

    expect(runtime).toHaveBeenCalledTimes(2);
  });

  it('drops cached runtime verification when invalidated', async () => {
    const minecraft = vi.fn().mockResolvedValue(verification(VerificationKinds.MINECRAFT, true));
    const runtime = vi.fn().mockResolvedValue(verification(VerificationKinds.RUNTIME, true));
    const kit = {
      verify: {
        minecraft: { run: minecraft },
        runtime: { run: runtime },
      },
    } as unknown as MinecraftKit;
    const sharedTarget = target();

    await expect(isTargetReady(kit, sharedTarget)).resolves.toBe(true);
    invalidateRuntimeVerification(sharedTarget);
    await expect(isTargetReady(kit, sharedTarget)).resolves.toBe(true);

    expect(runtime).toHaveBeenCalledTimes(2);
  });
});

describe('getTargetInstallState', () => {
  it('models runtime readiness separately from Minecraft readiness', async () => {
    const kit = {
      verify: {
        targetReady: {
          run: vi
            .fn()
            .mockResolvedValue(
              readiness([
                verification(VerificationKinds.MINECRAFT, true),
                verification(VerificationKinds.RUNTIME, false),
              ]),
            ),
        },
      },
    } as unknown as MinecraftKit;

    await expect(
      getTargetInstallState(kit, target(), {
        runtimeVerificationCache: RuntimeVerificationCacheModes.BYPASS,
      }),
    ).resolves.toEqual({
      minecraft: InstallReadinessStates.READY,
      runtime: InstallReadinessStates.NOT_READY,
      loader: InstallReadinessStates.NOT_APPLICABLE,
      bundle: InstallReadinessStates.UNKNOWN,
    });
  });

  it('models active loader readiness separately from the base game', async () => {
    const fabricTarget = target(Loaders.FABRIC);
    const kit = {
      verify: {
        targetReady: {
          run: vi
            .fn()
            .mockResolvedValue(
              readiness([
                verification(VerificationKinds.MINECRAFT, true),
                verification(VerificationKinds.RUNTIME, true),
                verification(VerificationKinds.FABRIC, false),
              ]),
            ),
        },
      },
    } as unknown as MinecraftKit;

    await expect(
      getTargetInstallState(kit, fabricTarget, {
        runtimeVerificationCache: RuntimeVerificationCacheModes.BYPASS,
      }),
    ).resolves.toEqual({
      minecraft: InstallReadinessStates.READY,
      runtime: InstallReadinessStates.READY,
      loader: InstallReadinessStates.NOT_READY,
      bundle: InstallReadinessStates.UNKNOWN,
    });
  });
});

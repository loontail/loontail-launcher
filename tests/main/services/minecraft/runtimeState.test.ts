import {
  Loaders,
  type MinecraftKit,
  type Target,
  VerificationKinds,
  type VerificationResult,
} from '@loontail/minecraft-kit';
import {
  InstallReadinessStates,
  getTargetInstallState,
  isTargetReady,
} from '@main/services/minecraft/runtimeState';
import { describe, expect, it, vi } from 'vitest';

const target = (loaderType: Target['loader']['type'] = Loaders.VANILLA): Target =>
  ({
    id: 'test-target',
    loader: { type: loaderType },
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

describe('isTargetReady', () => {
  it('uses the aggregate kit readiness API when it is available', async () => {
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

    await expect(isTargetReady(kit, target())).resolves.toBe(false);
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

    await expect(getTargetInstallState(kit, target())).resolves.toEqual({
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

    await expect(getTargetInstallState(kit, fabricTarget)).resolves.toEqual({
      minecraft: InstallReadinessStates.READY,
      runtime: InstallReadinessStates.READY,
      loader: InstallReadinessStates.NOT_READY,
      bundle: InstallReadinessStates.UNKNOWN,
    });
  });
});

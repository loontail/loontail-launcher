import { Loaders, type MinecraftKit, type Target } from '@loontail/minecraft-kit';
import { isTargetReady } from '@main/services/minecraft/runtimeState';
import { describe, expect, it, vi } from 'vitest';

const target = (loaderType: Target['loader']['type'] = Loaders.VANILLA): Target =>
  ({
    id: 'test-target',
    loader: { type: loaderType },
  }) as Target;

const verification = (isValid: boolean) => ({
  targetId: 'test-target',
  kind: 'minecraft',
  isValid,
  issues: [],
  checkedFiles: 0,
  durationMs: 0,
});

describe('isTargetReady', () => {
  it('uses the aggregate kit readiness API when it is available', async () => {
    const targetReady = vi.fn().mockResolvedValue({ isReady: false });
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
    const minecraft = vi.fn().mockResolvedValue(verification(true));
    const runtime = vi.fn().mockResolvedValue(verification(false));
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
    const minecraft = vi.fn().mockResolvedValue(verification(true));
    const runtime = vi.fn().mockResolvedValue(verification(true));
    const fabric = vi.fn().mockResolvedValue(verification(false));
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

import type { MinecraftKit, Target, VerificationResult } from '@loontail/minecraft-kit';
import { asCatalogKey } from '@shared/contracts/ids';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { type CreateHealerDeps, createHealer } from '@main/services/bundle/healer';

const SLUG = asCatalogKey('official:heal-client');
const CLIENT_FOLDER = '/clients/heal-client';
const TARGET = { id: 'fake-target' } as unknown as Target;

const cleanVerification: VerificationResult = {
  checkedFiles: 3,
  issues: [],
} as unknown as VerificationResult;

const makeKit = () =>
  ({
    targets: { resolve: vi.fn() },
    verify: { minecraft: { run: vi.fn(async () => cleanVerification) } },
    repair: { minecraft: { plan: vi.fn(), run: vi.fn() } },
  }) as unknown as MinecraftKit;

describe('createHealer.healAfterDeletes', () => {
  it('threads the resolved target + clientFolder into verify, never re-resolving', async () => {
    const kit = makeKit();
    const resolveContext = vi.fn(async () => ({ target: TARGET, clientFolder: CLIENT_FOLDER }));
    const deps: CreateHealerDeps = { resolveContext };
    const healer = createHealer(kit, deps);

    await healer.healAfterDeletes(SLUG, new Set<string>());

    expect(resolveContext).toHaveBeenCalledTimes(1);
    expect(resolveContext).toHaveBeenCalledWith(SLUG);
    // The injected target flows straight into the verify call — no second
    // target resolution inside the heal bridge.
    expect(kit.targets.resolve).not.toHaveBeenCalled();
    expect(kit.verify.minecraft.run).toHaveBeenCalledTimes(1);
    expect(kit.verify.minecraft.run).toHaveBeenCalledWith(TARGET, expect.anything());
  });
});

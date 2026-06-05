import { applyLauncherPatch } from '@main/services/settings/settings';
import { asClientSlug } from '@shared/contracts/ids';
import type { LauncherSettings, PatchLauncherSettings } from '@shared/contracts/settings';
import { describe, expect, it, vi } from 'vitest';

// Stub the store module so importing the service does not pull in electron.
vi.mock('@main/infra/store', () => ({
  getStoredLauncherSettings: () => undefined,
  setStoredLauncherSettings: (next: LauncherSettings) => next,
}));

const baseSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 2048 },
  storage: { clientsFolder: '/clients' },
  launch: { console: false, fullscreen: true },
  clients: { [asClientSlug('foo')]: { memory: { allocatedRamMb: 4096 } } },
});

describe('applyLauncherPatch', () => {
  it('applies a partial patch to a single section', () => {
    const next = applyLauncherPatch(baseSettings(), {
      memory: { allocatedRamMb: 8192 },
    });
    expect(next.memory.allocatedRamMb).toBe(8192);
    expect(next.storage).toEqual({ clientsFolder: '/clients' });
    expect(next.launch).toEqual({ console: false, fullscreen: true });
  });

  it('merges within a section, keeping untouched fields', () => {
    const next = applyLauncherPatch(baseSettings(), {
      launch: { console: true },
    });
    expect(next.launch).toEqual({ console: true, fullscreen: true });
  });

  it('is a no-op for omitted sections', () => {
    const current = baseSettings();
    const next = applyLauncherPatch(current, {});
    expect(next).toEqual(current);
  });

  it('preserves the clients record by reference', () => {
    const current = baseSettings();
    const next = applyLauncherPatch(current, { memory: { allocatedRamMb: 1 } });
    expect(next.clients).toBe(current.clients);
  });

  it('produces a result that round-trips through the schema', async () => {
    const { LauncherSettingsSchema } = await import('@shared/contracts/settings');
    const patch: PatchLauncherSettings = {
      memory: { allocatedRamMb: 1024 },
      storage: { clientsFolder: '/other' },
    };
    const next = applyLauncherPatch(baseSettings(), patch);
    expect(LauncherSettingsSchema.parse(next)).toEqual(next);
  });
});

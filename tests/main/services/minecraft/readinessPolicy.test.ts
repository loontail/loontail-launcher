import { asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { LauncherSettings } from '@shared/contracts/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const policyMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return {
    getSettings: vi.fn(),
    loadTargetInstallManifest: vi.fn(),
    isAnythingInstalled: vi.fn(),
  };
});

vi.mock('@main/services/minecraft/installManifest', () => ({
  loadTargetInstallManifest: policyMocks.loadTargetInstallManifest,
}));

vi.mock('@main/services/minecraft/runtimeState', () => ({
  isAnythingInstalled: policyMocks.isAnythingInstalled,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: policyMocks.getSettings,
}));

import { resolveClientInstallPresence } from '@main/services/minecraft/readinessPolicy';

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = 'Z:/clients/test-client';

const launcherSettings = (clientsFolder = 'Z:/clients'): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder },
  launch: { console: false, fullscreen: false },
  clients: {},
});

const resetPolicyMocks = (): void => {
  policyMocks.getSettings.mockReset();
  policyMocks.loadTargetInstallManifest.mockReset();
  policyMocks.isAnythingInstalled.mockReset();

  policyMocks.getSettings.mockReturnValue(launcherSettings());
  policyMocks.loadTargetInstallManifest.mockResolvedValue({ targetId: 'target-id' });
  policyMocks.isAnythingInstalled.mockResolvedValue(true);
};

describe('resolveClientInstallPresence', () => {
  beforeEach(() => {
    resetPolicyMocks();
  });

  it('seeds installed from local files (durable manifest + on-disk version)', async () => {
    await expect(resolveClientInstallPresence(SLUG)).resolves.toBe(InstallStatuses.INSTALLED);
    // Fully offline: only local files are read — no kit, no target resolve.
    expect(policyMocks.loadTargetInstallManifest).toHaveBeenCalledWith(CLIENT_FOLDER);
    expect(policyMocks.isAnythingInstalled).toHaveBeenCalledWith(CLIENT_FOLDER);
  });

  it('seeds unverified for a legacy install with on-disk files but no durable manifest', async () => {
    policyMocks.loadTargetInstallManifest.mockResolvedValue(null);
    policyMocks.isAnythingInstalled.mockResolvedValue(true);

    await expect(resolveClientInstallPresence(SLUG)).resolves.toBe(InstallStatuses.UNVERIFIED);
  });

  it('seeds not-installed when no version files are present', async () => {
    policyMocks.isAnythingInstalled.mockResolvedValue(false);

    await expect(resolveClientInstallPresence(SLUG)).resolves.toBe(InstallStatuses.NOT_INSTALLED);
  });

  it('seeds not-installed without reading files when no client folder is configured', async () => {
    policyMocks.getSettings.mockReturnValue(launcherSettings(''));

    await expect(resolveClientInstallPresence(SLUG)).resolves.toBe(InstallStatuses.NOT_INSTALLED);
    expect(policyMocks.loadTargetInstallManifest).not.toHaveBeenCalled();
    expect(policyMocks.isAnythingInstalled).not.toHaveBeenCalled();
  });
});

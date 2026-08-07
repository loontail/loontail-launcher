import { asCatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLauncherSettings } from '../../../helpers/fixtures';

const policyMocks = vi.hoisted(() => {
  return {
    getSettings: vi.fn(),
    loadTargetInstallManifest: vi.fn(),
    hasAnyVersionInstalled: vi.fn(),
  };
});

vi.mock('@main/services/minecraft/installManifest', () => ({
  loadTargetInstallManifest: policyMocks.loadTargetInstallManifest,
}));

vi.mock('@main/services/minecraft/installedVersions', () => ({
  hasAnyVersionInstalled: policyMocks.hasAnyVersionInstalled,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: policyMocks.getSettings,
}));

import { resolveClientInstallPresence } from '@main/services/minecraft/readinessPolicy';

const KEY = asCatalogKey('official:test-client');
const CLIENT_FOLDER = 'Z:/clients/test-client';

const launcherSettings = (clientsFolder = 'Z:/clients') =>
  makeLauncherSettings({ storage: { clientsFolder } });

const resetPolicyMocks = (): void => {
  policyMocks.getSettings.mockReset();
  policyMocks.loadTargetInstallManifest.mockReset();
  policyMocks.hasAnyVersionInstalled.mockReset();

  policyMocks.getSettings.mockReturnValue(launcherSettings());
  policyMocks.loadTargetInstallManifest.mockResolvedValue({ targetId: 'target-id' });
  policyMocks.hasAnyVersionInstalled.mockResolvedValue(true);
};

describe('resolveClientInstallPresence', () => {
  beforeEach(() => {
    resetPolicyMocks();
  });

  it('seeds installed from a durable manifest without scanning version files', async () => {
    await expect(resolveClientInstallPresence(KEY)).resolves.toBe(InstallStatuses.INSTALLED);
    // Fully offline: only the manifest is read — no kit, no target resolve.
    expect(policyMocks.loadTargetInstallManifest).toHaveBeenCalledWith(CLIENT_FOLDER);
    // The durable manifest implies on-disk files, so the version scan is skipped
    // on the happy path.
    expect(policyMocks.hasAnyVersionInstalled).not.toHaveBeenCalled();
  });

  it('seeds unverified for a legacy install with on-disk files but no durable manifest', async () => {
    policyMocks.loadTargetInstallManifest.mockResolvedValue(null);
    policyMocks.hasAnyVersionInstalled.mockResolvedValue(true);

    await expect(resolveClientInstallPresence(KEY)).resolves.toBe(InstallStatuses.UNVERIFIED);
  });

  it('seeds not-installed when no version files are present', async () => {
    policyMocks.loadTargetInstallManifest.mockResolvedValue(null);
    policyMocks.hasAnyVersionInstalled.mockResolvedValue(false);

    await expect(resolveClientInstallPresence(KEY)).resolves.toBe(InstallStatuses.NOT_INSTALLED);
  });

  it('seeds not-installed without reading files when no client folder is configured', async () => {
    policyMocks.getSettings.mockReturnValue(launcherSettings(''));

    await expect(resolveClientInstallPresence(KEY)).resolves.toBe(InstallStatuses.NOT_INSTALLED);
    expect(policyMocks.loadTargetInstallManifest).not.toHaveBeenCalled();
    expect(policyMocks.hasAnyVersionInstalled).not.toHaveBeenCalled();
  });
});

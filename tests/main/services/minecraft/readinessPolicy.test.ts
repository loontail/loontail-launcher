import { Loaders, type MinecraftKit, type Target } from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import { resolveClientInstallPresence } from '@main/services/minecraft/readinessPolicy';
import { asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { LauncherSettings } from '@shared/contracts/settings';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const policyMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return {
    buildContext: vi.fn(),
    getSettings: vi.fn(),
    hasCurrentTargetInstallManifest: vi.fn(),
    isAnythingInstalled: vi.fn(),
  };
});

vi.mock('@main/services/minecraft/context', () => ({
  buildContext: policyMocks.buildContext,
}));

vi.mock('@main/services/minecraft/installManifest', () => ({
  hasCurrentTargetInstallManifest: policyMocks.hasCurrentTargetInstallManifest,
}));

vi.mock('@main/services/minecraft/runtimeState', () => ({
  isAnythingInstalled: policyMocks.isAnythingInstalled,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: policyMocks.getSettings,
}));

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = 'Z:/clients/test-client';

const launcherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: 'Z:/clients' },
  launch: { console: false, fullscreen: false },
  clients: {},
});

const target = (loader: Target['loader']['type'] = Loaders.VANILLA): Target =>
  ({
    id: 'target-id',
    directory: CLIENT_FOLDER,
    loader: { type: loader },
  }) as unknown as Target;

const context = (loader: Target['loader']['type'] = Loaders.VANILLA): Context =>
  ({
    client: { slug: SLUG },
    clientFolder: CLIENT_FOLDER,
    target: target(loader),
  }) as unknown as Context;

const resetPolicyMocks = (): void => {
  policyMocks.buildContext.mockReset();
  policyMocks.getSettings.mockReset();
  policyMocks.hasCurrentTargetInstallManifest.mockReset();
  policyMocks.isAnythingInstalled.mockReset();

  policyMocks.buildContext.mockResolvedValue(context());
  policyMocks.getSettings.mockReturnValue(launcherSettings());
  policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(true);
  policyMocks.isAnythingInstalled.mockResolvedValue(true);
};

describe('resolveClientInstallPresence', () => {
  beforeEach(() => {
    resetPolicyMocks();
  });

  it('seeds installed from local state (manifest + on-disk files)', async () => {
    policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(true);
    policyMocks.isAnythingInstalled.mockResolvedValue(true);

    await expect(resolveClientInstallPresence({} as MinecraftKit, SLUG)).resolves.toBe(
      InstallStatuses.INSTALLED,
    );
  });

  it('seeds not-installed when no current install manifest is present', async () => {
    policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(false);
    policyMocks.isAnythingInstalled.mockResolvedValue(true);

    await expect(resolveClientInstallPresence({} as MinecraftKit, SLUG)).resolves.toBe(
      InstallStatuses.NOT_INSTALLED,
    );
  });

  it('seeds unverified when context cannot be built but old files exist', async () => {
    policyMocks.buildContext.mockRejectedValue(new Error('Client is not resolvable'));
    policyMocks.isAnythingInstalled.mockResolvedValue(true);

    await expect(resolveClientInstallPresence({} as MinecraftKit, SLUG)).resolves.toBe(
      InstallStatuses.UNVERIFIED,
    );
  });
});

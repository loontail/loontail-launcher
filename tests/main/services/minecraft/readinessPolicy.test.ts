import { Loaders, type MinecraftKit, type Target } from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import {
  ReadinessPolicyKinds,
  resolveClientInstallPresence,
  resolveTargetReadinessPolicy,
} from '@main/services/minecraft/readinessPolicy';
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
    getTargetInstallState: vi.fn(),
    hasCurrentTargetInstallManifest: vi.fn(),
    isAnythingInstalled: vi.fn(),
    saveCurrentTargetInstallManifest: vi.fn(),
  };
});

const installReadinessStates = {
  READY: 'ready',
  NOT_READY: 'not-ready',
  NOT_APPLICABLE: 'not-applicable',
  UNKNOWN: 'unknown',
} as const;

vi.mock('@main/services/minecraft/context', () => ({
  buildContext: policyMocks.buildContext,
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ warn: vi.fn() }),
}));

vi.mock('@main/services/minecraft/installManifest', () => ({
  hasCurrentTargetInstallManifest: policyMocks.hasCurrentTargetInstallManifest,
  saveCurrentTargetInstallManifest: policyMocks.saveCurrentTargetInstallManifest,
}));

vi.mock('@main/services/minecraft/runtimeState', () => ({
  getTargetInstallState: policyMocks.getTargetInstallState,
  isAnythingInstalled: policyMocks.isAnythingInstalled,
  isMinecraftTargetReady: (state: TargetInstallStateFixture) =>
    state.minecraft === 'ready' &&
    state.runtime === 'ready' &&
    (state.loader === 'ready' || state.loader === 'not-applicable'),
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: policyMocks.getSettings,
}));

type TargetInstallStateFixture = {
  readonly minecraft: (typeof installReadinessStates)[keyof typeof installReadinessStates];
  readonly runtime: (typeof installReadinessStates)[keyof typeof installReadinessStates];
  readonly loader: (typeof installReadinessStates)[keyof typeof installReadinessStates];
  readonly bundle: (typeof installReadinessStates)[keyof typeof installReadinessStates];
};

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

const targetState = (
  patch: Partial<TargetInstallStateFixture> = {},
): TargetInstallStateFixture => ({
  minecraft: installReadinessStates.READY,
  runtime: installReadinessStates.READY,
  loader: installReadinessStates.NOT_APPLICABLE,
  bundle: installReadinessStates.UNKNOWN,
  ...patch,
});

const resetPolicyMocks = (): void => {
  policyMocks.buildContext.mockReset();
  policyMocks.getSettings.mockReset();
  policyMocks.getTargetInstallState.mockReset();
  policyMocks.hasCurrentTargetInstallManifest.mockReset();
  policyMocks.isAnythingInstalled.mockReset();
  policyMocks.saveCurrentTargetInstallManifest.mockReset();

  policyMocks.buildContext.mockResolvedValue(context());
  policyMocks.getSettings.mockReturnValue(launcherSettings());
  policyMocks.getTargetInstallState.mockResolvedValue(targetState());
  policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(true);
  policyMocks.isAnythingInstalled.mockResolvedValue(true);
  policyMocks.saveCurrentTargetInstallManifest.mockResolvedValue(undefined);
};

describe('readiness policy', () => {
  beforeEach(() => {
    resetPolicyMocks();
  });

  it('resolves a current vanilla target as installed', async () => {
    await expect(resolveTargetReadinessPolicy({} as MinecraftKit, context())).resolves.toEqual(
      expect.objectContaining({
        kind: ReadinessPolicyKinds.INSTALLED,
        status: InstallStatuses.INSTALLED,
        freshInstall: false,
      }),
    );
  });

  it('resolves runtime failures as repairable installed-target drift', async () => {
    policyMocks.getTargetInstallState.mockResolvedValue(
      targetState({ runtime: installReadinessStates.NOT_READY }),
    );

    await expect(resolveTargetReadinessPolicy({} as MinecraftKit, context())).resolves.toEqual(
      expect.objectContaining({
        kind: ReadinessPolicyKinds.NEEDS_REPAIR,
        status: InstallStatuses.NOT_INSTALLED,
        freshInstall: false,
      }),
    );
  });

  it('resolves loader failures through the same policy result', async () => {
    policyMocks.getTargetInstallState.mockResolvedValue(
      targetState({ loader: installReadinessStates.NOT_READY }),
    );

    await expect(
      resolveTargetReadinessPolicy({} as MinecraftKit, context(Loaders.FORGE)),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: ReadinessPolicyKinds.NEEDS_REPAIR,
        status: InstallStatuses.NOT_INSTALLED,
      }),
    );
  });

  it('resolves ready targets with stale manifests as installed and refreshes the manifest', async () => {
    policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(false);

    await expect(resolveTargetReadinessPolicy({} as MinecraftKit, context())).resolves.toEqual(
      expect.objectContaining({
        kind: ReadinessPolicyKinds.INSTALLED,
        status: InstallStatuses.INSTALLED,
        hasCurrentManifest: false,
        freshInstall: false,
      }),
    );
    expect(policyMocks.saveCurrentTargetInstallManifest).toHaveBeenCalledWith(
      CLIENT_FOLDER,
      expect.objectContaining({ id: 'target-id' }),
    );
  });

  it('keeps ready targets installed when refreshing a stale manifest fails', async () => {
    policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(false);
    policyMocks.saveCurrentTargetInstallManifest.mockRejectedValue(new Error('disk full'));

    await expect(resolveTargetReadinessPolicy({} as MinecraftKit, context())).resolves.toEqual(
      expect.objectContaining({
        kind: ReadinessPolicyKinds.INSTALLED,
        status: InstallStatuses.INSTALLED,
        hasCurrentManifest: false,
        freshInstall: false,
      }),
    );
  });

  it('resolves stale target manifests with missing target files as install work', async () => {
    policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(false);
    policyMocks.getTargetInstallState.mockResolvedValue(
      targetState({ minecraft: installReadinessStates.NOT_READY }),
    );
    policyMocks.isAnythingInstalled.mockResolvedValue(false);

    await expect(resolveTargetReadinessPolicy({} as MinecraftKit, context())).resolves.toEqual(
      expect.objectContaining({
        kind: ReadinessPolicyKinds.NEEDS_INSTALL,
        status: InstallStatuses.NOT_INSTALLED,
        freshInstall: true,
      }),
    );
    expect(policyMocks.saveCurrentTargetInstallManifest).not.toHaveBeenCalled();
  });

  it('seeds installed from local state without running verification', async () => {
    policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(true);
    policyMocks.isAnythingInstalled.mockResolvedValue(true);

    await expect(resolveClientInstallPresence({} as MinecraftKit, SLUG)).resolves.toBe(
      InstallStatuses.INSTALLED,
    );
    // The cheap presence check must never hash/verify the install.
    expect(policyMocks.getTargetInstallState).not.toHaveBeenCalled();
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

import { Loaders, type MinecraftKit, type Target } from '@loontail/minecraft-kit';
import type { Context } from '@main/services/minecraft/context';
import {
  ReadinessPolicyKinds,
  resolveClientReadinessPolicy,
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

vi.mock('@main/services/minecraft/installManifest', () => ({
  hasCurrentTargetInstallManifest: policyMocks.hasCurrentTargetInstallManifest,
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

  policyMocks.buildContext.mockResolvedValue(context());
  policyMocks.getSettings.mockReturnValue(launcherSettings());
  policyMocks.getTargetInstallState.mockResolvedValue(targetState());
  policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(true);
  policyMocks.isAnythingInstalled.mockResolvedValue(true);
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

  it('resolves stale target manifests as install work with legacy freshness', async () => {
    policyMocks.hasCurrentTargetInstallManifest.mockResolvedValue(false);
    policyMocks.isAnythingInstalled.mockResolvedValue(false);

    await expect(resolveTargetReadinessPolicy({} as MinecraftKit, context())).resolves.toEqual(
      expect.objectContaining({
        kind: ReadinessPolicyKinds.NEEDS_INSTALL,
        status: InstallStatuses.NOT_INSTALLED,
        freshInstall: true,
      }),
    );
  });

  it('resolves context failures as unverified when old files exist', async () => {
    policyMocks.buildContext.mockRejectedValue(new Error('Client is not resolvable'));
    policyMocks.isAnythingInstalled.mockResolvedValue(true);

    await expect(resolveClientReadinessPolicy({} as MinecraftKit, SLUG)).resolves.toEqual(
      expect.objectContaining({
        kind: ReadinessPolicyKinds.UNVERIFIED,
        status: InstallStatuses.UNVERIFIED,
        hasLegacyInstall: true,
        freshInstall: false,
      }),
    );
  });
});

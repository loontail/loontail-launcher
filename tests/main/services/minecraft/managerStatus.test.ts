import { type MinecraftKit, PauseController, type Target } from '@loontail/minecraft-kit';
import { describe, expect, it, vi } from 'vitest';

const statusMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return {
    buildContext: vi.fn(),
    getSettings: vi.fn(),
    hasCurrentTargetInstallManifest: vi.fn(),
    isAnythingInstalled: vi.fn(),
    isTargetReady: vi.fn(),
    resolveClientReadinessPolicy: vi.fn(),
    setClientOverride: vi.fn(),
  };
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/minecraft/context', () => ({
  buildContext: statusMocks.buildContext,
}));

vi.mock('@main/services/minecraft/runtimeState', () => ({
  RuntimeVerificationCacheModes: {
    USE: 'use',
    BYPASS: 'bypass',
  },
  isAnythingInstalled: statusMocks.isAnythingInstalled,
  isTargetReady: statusMocks.isTargetReady,
}));

vi.mock('@main/services/minecraft/installManifest', () => ({
  hasCurrentTargetInstallManifest: statusMocks.hasCurrentTargetInstallManifest,
}));

vi.mock('@main/services/minecraft/readinessPolicy', () => ({
  ReadinessPolicyKinds: {
    INSTALLED: 'installed',
    NEEDS_INSTALL: 'needs-install',
    NEEDS_REPAIR: 'needs-repair',
    UNVERIFIED: 'unverified',
  },
  resolveClientReadinessPolicy: statusMocks.resolveClientReadinessPolicy,
  resolveTargetReadinessPolicy: vi.fn(),
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: statusMocks.getSettings,
  setClientOverride: statusMocks.setClientOverride,
}));

import type { Broadcaster } from '@main/services/minecraft/broadcast';
import { MinecraftManager } from '@main/services/minecraft/manager';
import { type InstallOp, OpKinds } from '@main/services/minecraft/ops';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { LauncherSettings } from '@shared/contracts/settings';

const SLUG = asClientSlug('test-client');
const CLIENT_FOLDER = '/tmp/clients/test-client';

const launcherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: '/tmp/clients' },
  launch: { console: false, fullscreen: false },
  clients: {},
});

const makeBroadcaster = (): Broadcaster =>
  ({
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  }) as unknown as Broadcaster;

const makeManager = (): MinecraftManager =>
  new MinecraftManager(makeBroadcaster(), {
    targets: { resolve: vi.fn() },
  } as unknown as MinecraftKit);

const resetStatusMocks = (): void => {
  statusMocks.buildContext.mockReset();
  statusMocks.getSettings.mockReset();
  statusMocks.hasCurrentTargetInstallManifest.mockReset();
  statusMocks.isAnythingInstalled.mockReset();
  statusMocks.isTargetReady.mockReset();
  statusMocks.resolveClientReadinessPolicy.mockReset();
  statusMocks.setClientOverride.mockReset();

  statusMocks.getSettings.mockReturnValue(launcherSettings());
  statusMocks.hasCurrentTargetInstallManifest.mockResolvedValue(true);
  statusMocks.isAnythingInstalled.mockResolvedValue(false);
  statusMocks.isTargetReady.mockResolvedValue(true);
  statusMocks.resolveClientReadinessPolicy.mockResolvedValue({
    kind: 'installed',
    status: InstallStatuses.INSTALLED,
    freshInstall: false,
  });
};

describe('MinecraftManager.getStatus', () => {
  it('reports not-installed when the current target is not ready even if old files exist', async () => {
    resetStatusMocks();
    statusMocks.buildContext.mockResolvedValue({
      target: {} as Target,
      clientFolder: CLIENT_FOLDER,
    });
    statusMocks.resolveClientReadinessPolicy.mockResolvedValue({
      kind: 'needs-repair',
      status: InstallStatuses.NOT_INSTALLED,
      freshInstall: false,
    });

    await expect(makeManager().getStatus(SLUG)).resolves.toEqual({
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
    expect(statusMocks.resolveClientReadinessPolicy).toHaveBeenCalledWith(expect.any(Object), SLUG);
  });

  it('reports not-installed without readiness verification when the target manifest is stale', async () => {
    resetStatusMocks();
    statusMocks.buildContext.mockResolvedValue({
      target: {} as Target,
      clientFolder: CLIENT_FOLDER,
    });
    statusMocks.resolveClientReadinessPolicy.mockResolvedValue({
      kind: 'needs-install',
      status: InstallStatuses.NOT_INSTALLED,
      freshInstall: true,
    });

    await expect(makeManager().getStatus(SLUG)).resolves.toEqual({
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('reports unverified when target context cannot be built but old files exist', async () => {
    resetStatusMocks();
    statusMocks.resolveClientReadinessPolicy.mockResolvedValue({
      kind: 'unverified',
      status: InstallStatuses.UNVERIFIED,
      hasLegacyInstall: true,
      freshInstall: false,
    });

    await expect(makeManager().getStatus(SLUG)).resolves.toEqual({
      status: InstallStatuses.UNVERIFIED,
      paused: false,
    });
  });

  it('reports not-installed when target context cannot be built and no files exist', async () => {
    resetStatusMocks();
    statusMocks.resolveClientReadinessPolicy.mockResolvedValue({
      kind: 'unverified',
      status: InstallStatuses.NOT_INSTALLED,
      hasLegacyInstall: false,
      freshInstall: true,
    });

    await expect(makeManager().getStatus(SLUG)).resolves.toEqual({
      status: InstallStatuses.NOT_INSTALLED,
      paused: false,
    });
  });

  it('keeps smart-resume install operations visible as repair status', async () => {
    resetStatusMocks();
    const manager = makeManager();
    const op: InstallOp = {
      kind: OpKinds.INSTALL,
      status: InstallStatuses.REPAIRING,
      pauseController: new PauseController(),
      abort: new AbortController(),
      paused: true,
      cancelled: false,
      fresh: false,
    };
    const internals = manager as unknown as { ops: Map<ClientSlug, InstallOp> };
    internals.ops.set(SLUG, op);

    await expect(manager.getStatus(SLUG)).resolves.toEqual({
      status: InstallStatuses.REPAIRING,
      paused: false,
    });
  });
});

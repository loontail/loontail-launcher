import { type MinecraftKit, PauseController } from '@loontail/minecraft-kit';
import { describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: vi.fn(),
  setClientOverride: vi.fn(),
}));

import { isCancelled } from '@main/infra/lifecyclePhase';
import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import { MinecraftManager } from '@main/services/minecraft/manager';
import { type Op, OpKinds, type OpMap } from '@main/services/minecraft/ops';
import { asCatalogKey } from '@shared/contracts/ids';
import {
  stubAccountProvider,
  stubClearBundleManifest,
  stubConsoleSink,
  stubOpenConsole,
  stubResolveBuild,
  stubResolveBundleRepairFilter,
} from './managerStubs';

const KEY = asCatalogKey('official:test-client');

const makeManager = (): { manager: MinecraftManager; ops: OpMap; broadcaster: Broadcaster } => {
  const ops: OpMap = new Map();
  const broadcaster = {
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  } as unknown as Broadcaster;
  const manager = new MinecraftManager(
    broadcaster,
    { targets: { resolve: vi.fn() } } as unknown as MinecraftKit,
    createClientOperationLocks(),
    stubConsoleSink(),
    stubOpenConsole(),
    stubAccountProvider(),
    stubResolveBundleRepairFilter(),
    stubClearBundleManifest(),
    stubResolveBuild(),
    ops,
  );
  return { manager, ops, broadcaster };
};

const installOp = (): Op => ({
  kind: OpKinds.INSTALL,
  pauseController: new PauseController(),
  abort: new AbortController(),
  phase: 'running',
});

describe('MinecraftManager.cancel', () => {
  it('refuses a Pause or Resume that lands after a Stop', () => {
    // cancel() aborts but leaves the op in `ops` until runInstall's finally, and
    // handleInstallFailure spends that window rm -rf'ing a full Minecraft install.
    // A Pause click in it used to set paused=true and emit INSTALLING/paused for a
    // client whose folder was being deleted.
    const { manager, ops, broadcaster } = makeManager();
    const op = installOp();
    ops.set(KEY, op);

    manager.cancel(KEY);
    vi.mocked(broadcaster.status).mockClear();
    manager.pause(KEY);
    manager.resume(KEY);

    expect(op.kind === OpKinds.INSTALL && op.phase).toBe('cancelled');
    expect(broadcaster.status).not.toHaveBeenCalled();
  });

  it('aborts an install op and marks it cancelled', () => {
    const { manager, ops } = makeManager();
    const op = installOp();
    ops.set(KEY, op);

    manager.cancel(KEY);

    expect(op.kind === OpKinds.INSTALL && isCancelled(op)).toBe(true);
    expect(op.kind === OpKinds.INSTALL && op.abort.signal.aborted).toBe(true);
  });

  it.each([
    OpKinds.INSTALL_STARTING,
    OpKinds.REPAIR,
    OpKinds.BUNDLE_SYNCING,
    OpKinds.LAUNCH_STARTING,
  ] as const)('aborts the %s op', (kind) => {
    const { manager, ops } = makeManager();
    const abort = new AbortController();
    ops.set(KEY, { kind, abort } as Op);

    manager.cancel(KEY);

    expect(abort.signal.aborted).toBe(true);
  });

  it('warns but does not throw when cancelling an uninstall op', () => {
    const { manager, ops } = makeManager();
    ops.set(KEY, { kind: OpKinds.UNINSTALL } as Op);

    expect(() => manager.cancel(KEY)).not.toThrow();
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it('does nothing for a running launch op', () => {
    // cancel() must not reach into a live game: aborting the launch session here
    // would kill the player's running Minecraft over an unrelated Stop click.
    const { manager, ops } = makeManager();
    const sessionAbort = vi.fn();
    ops.set(KEY, {
      kind: OpKinds.LAUNCH,
      session: { abort: sessionAbort },
      consoleEnabled: false,
    } as unknown as Op);

    manager.cancel(KEY);

    expect(sessionAbort).not.toHaveBeenCalled();
    expect(ops.get(KEY)?.kind).toBe(OpKinds.LAUNCH);
  });
});

describe('MinecraftManager.cancelAll', () => {
  it('aborts an in-flight bundle sync on shutdown', () => {
    const { manager, ops } = makeManager();
    const abort = new AbortController();
    ops.set(KEY, { kind: OpKinds.BUNDLE_SYNCING, abort } as Op);

    manager.cancelAll();

    expect(abort.signal.aborted).toBe(true);
  });

  it('leaves a running launch session untouched', () => {
    const { manager, ops } = makeManager();
    const sessionAbort = vi.fn();
    ops.set(KEY, {
      kind: OpKinds.LAUNCH,
      session: { abort: sessionAbort },
      consoleEnabled: false,
    } as unknown as Op);

    manager.cancelAll();

    expect(sessionAbort).not.toHaveBeenCalled();
  });
});

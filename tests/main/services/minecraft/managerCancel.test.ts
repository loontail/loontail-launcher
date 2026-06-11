import { type MinecraftKit, PauseController } from '@loontail/minecraft-kit';
import { describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: vi.fn(),
  setClientOverride: vi.fn(),
}));

import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import { MinecraftManager } from '@main/services/minecraft/manager';
import { type Op, OpKinds } from '@main/services/minecraft/ops';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { stubAccountProvider, stubConsolePort, stubOpenConsole } from './managerStubs';

const SLUG = asClientSlug('test-client');

const makeManager = (): MinecraftManager =>
  new MinecraftManager(
    { status: vi.fn(), progress: vi.fn(), log: vi.fn(), error: vi.fn() } as unknown as Broadcaster,
    { targets: { resolve: vi.fn() } } as unknown as MinecraftKit,
    createClientOperationLocks(),
    stubConsolePort(),
    stubOpenConsole(),
    stubAccountProvider(),
  );

const setOp = (manager: MinecraftManager, op: Op): void => {
  (manager as unknown as { ops: Map<ClientSlug, Op> }).ops.set(SLUG, op);
};

const installOp = (): Op => ({
  kind: OpKinds.INSTALL,
  pauseController: new PauseController(),
  abort: new AbortController(),
  paused: false,
  cancelled: false,
  fresh: true,
});

describe('MinecraftManager.cancel', () => {
  it('aborts an install op and marks it cancelled', () => {
    const manager = makeManager();
    const op = installOp();
    setOp(manager, op);

    manager.cancel(SLUG);

    expect(op.kind === OpKinds.INSTALL && op.cancelled).toBe(true);
    expect(op.kind === OpKinds.INSTALL && op.abort.signal.aborted).toBe(true);
  });

  it.each([OpKinds.REPAIR, OpKinds.BUNDLE_SYNCING, OpKinds.LAUNCH_STARTING] as const)(
    'aborts the %s op',
    (kind) => {
      const manager = makeManager();
      const abort = new AbortController();
      setOp(manager, { kind, abort } as Op);

      manager.cancel(SLUG);

      expect(abort.signal.aborted).toBe(true);
    },
  );

  it('warns but does not throw when cancelling an uninstall op', () => {
    const manager = makeManager();
    setOp(manager, { kind: OpKinds.UNINSTALL } as Op);

    expect(() => manager.cancel(SLUG)).not.toThrow();
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it('does nothing for a running launch op', () => {
    const manager = makeManager();
    setOp(manager, {
      kind: OpKinds.LAUNCH,
      session: { abort: vi.fn() },
      consoleEnabled: false,
    } as unknown as Op);

    expect(() => manager.cancel(SLUG)).not.toThrow();
  });
});

describe('MinecraftManager.cancelAll', () => {
  it('aborts an in-flight bundle sync on shutdown', () => {
    const manager = makeManager();
    const abort = new AbortController();
    setOp(manager, { kind: OpKinds.BUNDLE_SYNCING, abort } as Op);

    manager.cancelAll();

    expect(abort.signal.aborted).toBe(true);
  });

  it('leaves a running launch session untouched', () => {
    const manager = makeManager();
    const sessionAbort = vi.fn();
    setOp(manager, {
      kind: OpKinds.LAUNCH,
      session: { abort: sessionAbort },
      consoleEnabled: false,
    } as unknown as Op);

    manager.cancelAll();

    expect(sessionAbort).not.toHaveBeenCalled();
  });
});

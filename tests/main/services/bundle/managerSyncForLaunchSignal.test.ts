import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
});

import type { BundleBroadcaster } from '@main/services/bundle/broadcast';
import type { Healer } from '@main/services/bundle/healer';
import { BundleManager } from '@main/services/bundle/manager';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const SLUG = 'test-client' as ClientSlug;

const makeBroadcaster = (): BundleBroadcaster => ({
  status: vi.fn(),
  progress: vi.fn(),
  error: vi.fn(),
});

const makeHealer = (): Healer =>
  ({
    healAfterDeletes: vi.fn(async () => {}),
  }) as unknown as Healer;

describe('BundleManager.syncForLaunch external signal', () => {
  it('throws ABORTED before touching client lookup when signal is already aborted', async () => {
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer());
    const controller = new AbortController();
    controller.abort();

    await expect(manager.syncForLaunch(SLUG, controller.signal)).rejects.toMatchObject({
      code: BundleErrorCodes.ABORTED,
    });
    // Pre-abort short-circuits before any status broadcast.
    expect(broadcaster.status).not.toHaveBeenCalled();
  });

  it('attaches an abort listener that calls cancelSync mid-flight', async () => {
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer());
    const cancelSpy = vi.spyOn(manager, 'cancelSync');
    const controller = new AbortController();

    // runSync needs a real client lookup; we don't care about the outcome here —
    // we only need the listener to be attached, then verify firing it cancels.
    const pending = manager.syncForLaunch(SLUG, controller.signal).catch(() => {});
    controller.abort();
    await pending;

    expect(cancelSpy).toHaveBeenCalledWith(SLUG);
  });
});

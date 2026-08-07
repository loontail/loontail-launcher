import { clearLauncherCache } from '@renderer/features/settings/clearCache';
import { subscribeToToasts, type ToastPayload } from '@renderer/shared/ui/Toast/toast';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

const identity = ((key: string) => key) as unknown as TFunction;

const collectToasts = (): { toasts: ToastPayload[]; stop: () => void } => {
  const toasts: ToastPayload[] = [];
  const stop = subscribeToToasts((payload) => toasts.push(payload));
  return { toasts, stop };
};

describe('clearLauncherCache', () => {
  let stop: () => void = () => undefined;

  afterEach(() => stop());

  it('clears non-auth/media queries and confirms success on disk clear', async () => {
    const removeQueries = vi.fn();
    const queryClient = { removeQueries } as unknown as QueryClient;
    const clearMediaCache = vi.fn(() => Promise.resolve());
    const collected = collectToasts();
    stop = collected.stop;

    await clearLauncherCache(queryClient, clearMediaCache, identity);

    expect(removeQueries).toHaveBeenCalledTimes(1);
    expect(clearMediaCache).toHaveBeenCalledTimes(1);
    expect(collected.toasts).toEqual([
      { message: 'settings.launcher.cacheClearedToast', variant: 'success' },
    ]);
  });

  it('warns instead of confirming success when the disk clear fails', async () => {
    const queryClient = { removeQueries: vi.fn() } as unknown as QueryClient;
    const clearMediaCache = vi.fn(() => Promise.reject(new Error('disk full')));
    const collected = collectToasts();
    stop = collected.stop;

    await clearLauncherCache(queryClient, clearMediaCache, identity);

    expect(collected.toasts).toEqual([
      { message: 'settings.launcher.cacheClearFailedToast', variant: 'warn' },
    ]);
  });
});

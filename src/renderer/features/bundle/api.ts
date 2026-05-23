import type { BundleInstallState } from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';
import { IPC_CHANNELS } from '@shared/ipc';

export const start = (slug: ClientSlug, force?: boolean): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.bundleStart, { slug, ...(force ? { force } : {}) });

export const pause = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.bundlePause, slug);

export const resume = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.bundleResume, slug);

export const cancel = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.bundleCancel, slug);

export const checkStatus = (slug: ClientSlug): Promise<BundleInstallState> =>
  window.api.invoke(IPC_CHANNELS.bundleCheckStatus, slug);

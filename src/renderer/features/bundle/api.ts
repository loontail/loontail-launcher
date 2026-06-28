import type { BundleInstallState } from '@shared/contracts/bundle';
import type { CatalogKey } from '@shared/contracts/ids';
import { IPC_CHANNELS } from '@shared/ipc';

export const start = (key: CatalogKey, force?: boolean): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.bundleStart, { slug: key, ...(force ? { force } : {}) });

export const pause = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.bundlePause, key);

export const resume = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.bundleResume, key);

export const cancel = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.bundleCancel, key);

export const checkStatus = (key: CatalogKey): Promise<BundleInstallState> =>
  window.api.invoke(IPC_CHANNELS.bundleCheckStatus, key);

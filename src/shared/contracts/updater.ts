export const UpdaterStates = {
  CHECKING: 'checking',
  AVAILABLE: 'available',
  NOT_AVAILABLE: 'not-available',
  // Reserved: the Squirrel.Windows autoUpdater exposes no download progress, so
  // the service stays on AVAILABLE through the opaque download and never emits
  // DOWNLOADING today. Kept (with renderer handling) for a future progress-
  // capable backend; the `percent` member is what such a backend would carry.
  DOWNLOADING: 'downloading',
  READY: 'ready',
  ERROR: 'error',
} as const satisfies Record<string, string>;

export type UpdaterState = (typeof UpdaterStates)[keyof typeof UpdaterStates];

export type UpdaterStatusEvent =
  | { state: typeof UpdaterStates.CHECKING }
  | { state: typeof UpdaterStates.AVAILABLE; version: string }
  | { state: typeof UpdaterStates.NOT_AVAILABLE }
  | { state: typeof UpdaterStates.DOWNLOADING; percent: number }
  | { state: typeof UpdaterStates.READY; version: string }
  | { state: typeof UpdaterStates.ERROR; message: string };

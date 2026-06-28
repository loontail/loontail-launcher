export const UpdaterStates = {
  CHECKING: 'checking',
  AVAILABLE: 'available',
  NOT_AVAILABLE: 'not-available',
  READY: 'ready',
  ERROR: 'error',
} as const satisfies Record<string, string>;

export type UpdaterState = (typeof UpdaterStates)[keyof typeof UpdaterStates];

export type UpdaterStatusEvent =
  | { state: typeof UpdaterStates.CHECKING }
  | { state: typeof UpdaterStates.AVAILABLE; version?: string }
  | { state: typeof UpdaterStates.NOT_AVAILABLE }
  | { state: typeof UpdaterStates.READY; version: string }
  | { state: typeof UpdaterStates.ERROR; message: string };

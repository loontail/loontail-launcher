import type { LaunchSession, PauseController } from '@loontail/minecraft-kit';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';

export const OpKinds = {
  INSTALL: 'install',
  REPAIR: 'repair',
  UNINSTALL: 'uninstall',
  BUNDLE_SYNCING: 'bundle-syncing',
  LAUNCH: 'launch',
} as const;

export type OpKind = (typeof OpKinds)[keyof typeof OpKinds];

export type InstallOp = {
  kind: typeof OpKinds.INSTALL;
  pauseController: PauseController;
  abort: AbortController;
  paused: boolean;
  cancelled: boolean;
  // false = implicit pre-launch update; cancelling such an op keeps the existing folder.
  fresh: boolean;
};

export type RepairOp = { kind: typeof OpKinds.REPAIR; abort: AbortController };
export type UninstallOp = { kind: typeof OpKinds.UNINSTALL };
// Represents the pre-launch bundle sync window between `runInstall` cleanup
// and `runLaunch` startup. Holds an abort controller so `cancel(slug)` can
// stop an in-flight bundle download mid-flight.
export type BundleSyncingOp = {
  kind: typeof OpKinds.BUNDLE_SYNCING;
  abort: AbortController;
};
export type LaunchOp = {
  kind: typeof OpKinds.LAUNCH;
  session: LaunchSession;
  consoleEnabled: boolean;
};

export type Op = InstallOp | RepairOp | UninstallOp | BundleSyncingOp | LaunchOp;

export const OP_TO_STATUS: Record<OpKind, InstallStatus> = {
  [OpKinds.INSTALL]: InstallStatuses.INSTALLING,
  [OpKinds.REPAIR]: InstallStatuses.REPAIRING,
  [OpKinds.UNINSTALL]: InstallStatuses.UNINSTALLING,
  [OpKinds.BUNDLE_SYNCING]: InstallStatuses.LAUNCHING,
  [OpKinds.LAUNCH]: InstallStatuses.RUNNING,
};

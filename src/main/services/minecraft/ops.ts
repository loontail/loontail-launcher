import type { LaunchSession, PauseController } from '@loontail/minecraft-kit';
import type { CatalogKey } from '@shared/contracts/ids';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';

export const OpKinds = {
  INSTALL_STARTING: 'install-starting',
  INSTALL: 'install',
  REPAIR: 'repair',
  UNINSTALL: 'uninstall',
  BUNDLE_SYNCING: 'bundle-syncing',
  LAUNCH_STARTING: 'launch-starting',
  LAUNCH: 'launch',
} as const;

export type OpKind = (typeof OpKinds)[keyof typeof OpKinds];

// Claimed synchronously before buildContext resolves so a concurrent startLaunch
// trips requireIdle during setup; beginInstall replaces it, carrying this abort
// controller forward so a Stop during buildContext is honored.
export type InstallStartingOp = {
  kind: typeof OpKinds.INSTALL_STARTING;
  abort: AbortController;
};

export type InstallOp = {
  kind: typeof OpKinds.INSTALL;
  pauseController: PauseController;
  abort: AbortController;
  paused: boolean;
  cancelled: boolean;
};

export type RepairOp = { kind: typeof OpKinds.REPAIR; abort: AbortController };
export type UninstallOp = { kind: typeof OpKinds.UNINSTALL };
// A bundle sync window (pre-launch, post-install, or post-repair); the abort
// controller lets cancel(slug) stop an in-flight bundle download.
export type BundleSyncingOp = {
  kind: typeof OpKinds.BUNDLE_SYNCING;
  abort: AbortController;
};
export type LaunchStartingOp = {
  kind: typeof OpKinds.LAUNCH_STARTING;
  abort: AbortController;
};
export type LaunchOp = {
  kind: typeof OpKinds.LAUNCH;
  session: LaunchSession;
};

export type Op =
  | InstallStartingOp
  | InstallOp
  | RepairOp
  | UninstallOp
  | BundleSyncingOp
  | LaunchStartingOp
  | LaunchOp;

export const OP_TO_STATUS: Record<OpKind, InstallStatus> = {
  [OpKinds.INSTALL_STARTING]: InstallStatuses.INSTALLING,
  [OpKinds.INSTALL]: InstallStatuses.INSTALLING,
  [OpKinds.REPAIR]: InstallStatuses.REPAIRING,
  [OpKinds.UNINSTALL]: InstallStatuses.UNINSTALLING,
  [OpKinds.BUNDLE_SYNCING]: InstallStatuses.LAUNCHING,
  [OpKinds.LAUNCH_STARTING]: InstallStatuses.LAUNCHING,
  [OpKinds.LAUNCH]: InstallStatuses.RUNNING,
};

// The manager (this.ops) and the consumer modules (ManagerEnv.ops) must point at
// the same live Map: consumers mutate it, the manager reads it back.
export type OpMap = Map<CatalogKey, Op>;

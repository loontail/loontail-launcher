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

// Placeholder op claimed synchronously by startInstall before buildContext
// resolves, so getStatus reports INSTALLING and a concurrent startLaunch trips
// requireIdle during setup. beginInstall replaces it with the real InstallOp,
// carrying this abort controller forward so a Stop during buildContext is honored.
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
// Represents a bundle sync window: pre-launch (between install and launch),
// post-install, or post-repair. Holds an abort controller so `cancel(slug)`
// can stop an in-flight bundle download mid-flight.
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

// The manager and the consumer modules (install/launch/repair/uninstall) share
// one live Map of in-flight ops per slug: the manager reads it back via this.ops
// while the consumers mutate it through ManagerEnv.ops, both pointing at the same
// object.
export type OpMap = Map<CatalogKey, Op>;

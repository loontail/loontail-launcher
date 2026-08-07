import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';

export type BuildStatusGlyph = 'installed' | 'update' | 'download' | 'busy' | 'error';

const GLYPH_BY_STATUS: Record<InstallStatus, BuildStatusGlyph> = {
  [InstallStatuses.UNKNOWN]: 'busy',
  [InstallStatuses.NOT_INSTALLED]: 'download',
  [InstallStatuses.UNVERIFIED]: 'update',
  [InstallStatuses.INSTALLING]: 'busy',
  [InstallStatuses.INSTALLED]: 'installed',
  [InstallStatuses.LAUNCHING]: 'busy',
  [InstallStatuses.RUNNING]: 'installed',
  [InstallStatuses.REPAIRING]: 'busy',
  [InstallStatuses.UNINSTALLING]: 'busy',
  [InstallStatuses.ERROR]: 'error',
};

const LABEL_KEY_BY_STATUS: Record<InstallStatus, string> = {
  [InstallStatuses.UNKNOWN]: 'builds.status.unknown',
  [InstallStatuses.NOT_INSTALLED]: 'builds.status.notInstalled',
  [InstallStatuses.UNVERIFIED]: 'builds.status.needsVerify',
  [InstallStatuses.INSTALLING]: 'builds.status.installing',
  [InstallStatuses.INSTALLED]: 'builds.status.ready',
  [InstallStatuses.LAUNCHING]: 'builds.status.launching',
  [InstallStatuses.RUNNING]: 'builds.status.running',
  [InstallStatuses.REPAIRING]: 'builds.status.repairing',
  [InstallStatuses.UNINSTALLING]: 'builds.status.removing',
  [InstallStatuses.ERROR]: 'builds.status.error',
};

export const describeBuildStatus = (
  status: InstallStatus,
): { labelKey: string; glyph: BuildStatusGlyph } => ({
  labelKey: LABEL_KEY_BY_STATUS[status],
  glyph: GLYPH_BY_STATUS[status],
});

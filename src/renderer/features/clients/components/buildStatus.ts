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
  [InstallStatuses.UNKNOWN]: 'clients.status.unknown',
  [InstallStatuses.NOT_INSTALLED]: 'clients.status.notInstalled',
  [InstallStatuses.UNVERIFIED]: 'clients.status.needsVerify',
  [InstallStatuses.INSTALLING]: 'clients.status.installing',
  [InstallStatuses.INSTALLED]: 'clients.status.ready',
  [InstallStatuses.LAUNCHING]: 'clients.status.launching',
  [InstallStatuses.RUNNING]: 'clients.status.running',
  [InstallStatuses.REPAIRING]: 'clients.status.repairing',
  [InstallStatuses.UNINSTALLING]: 'clients.status.removing',
  [InstallStatuses.ERROR]: 'clients.status.error',
};

export const describeBuildStatus = (
  status: InstallStatus,
): { labelKey: string; glyph: BuildStatusGlyph } => ({
  labelKey: LABEL_KEY_BY_STATUS[status],
  glyph: GLYPH_BY_STATUS[status],
});

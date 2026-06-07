import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';

export type BuildStatusTone = 'ready' | 'active' | 'pending' | 'idle' | 'error';

const TONE_BY_STATUS: Record<InstallStatus, BuildStatusTone> = {
  [InstallStatuses.UNKNOWN]: 'idle',
  [InstallStatuses.NOT_INSTALLED]: 'idle',
  [InstallStatuses.UNVERIFIED]: 'pending',
  [InstallStatuses.INSTALLING]: 'pending',
  [InstallStatuses.INSTALLED]: 'ready',
  [InstallStatuses.LAUNCHING]: 'active',
  [InstallStatuses.RUNNING]: 'active',
  [InstallStatuses.REPAIRING]: 'pending',
  [InstallStatuses.UNINSTALLING]: 'pending',
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

// Pure status → label/tone mapping (no React/feature imports) so it's testable
// in isolation and the table's completeness is enforced by the Record types.
export const describeBuildStatus = (
  status: InstallStatus,
): { labelKey: string; tone: BuildStatusTone } => ({
  labelKey: LABEL_KEY_BY_STATUS[status],
  tone: TONE_BY_STATUS[status],
});

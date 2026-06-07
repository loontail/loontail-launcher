import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';

export type BuildStatusTone = 'ready' | 'active' | 'pending' | 'idle' | 'error';

// Icon glyph for the monochrome status chip. State is read from icon + label
// only — never from hue. `busy` glyphs spin.
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

// Pure status → label/tone/glyph mapping (no React/feature imports) so it's
// testable in isolation and the tables' completeness is enforced by the Record
// types.
export const describeBuildStatus = (
  status: InstallStatus,
): { labelKey: string; tone: BuildStatusTone; glyph: BuildStatusGlyph } => ({
  labelKey: LABEL_KEY_BY_STATUS[status],
  tone: TONE_BY_STATUS[status],
  glyph: GLYPH_BY_STATUS[status],
});

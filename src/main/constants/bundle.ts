// Parallel workers pulling the pending-downloads queue: higher = more concurrent
// sockets, lower = gentler on slow upstreams.
export const BUNDLE_DOWNLOAD_CONCURRENCY = 16;

export const BUNDLE_DOWNLOAD_MAX_REDIRECTS = 5;

export { PROGRESS_THROTTLE_MS as BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS } from '@shared/constants';

export const BUNDLE_DOWNLOAD_SPEED_WINDOW_MS = 1000;

// Per-request safety net so a stalled socket doesn't hang a sync forever.
export const BUNDLE_DOWNLOAD_REQUEST_TIMEOUT_MS = 60_000;

// Idle paused syncs are auto-cancelled to free the activeSyncs slot; without
// this, "pause then never resume" wedges the slug for the rest of the session.
export const BUNDLE_PAUSED_SYNC_MAX_IDLE_MS = 5 * 60_000;

// How long getInstallState may reuse a fetched remote manifest hash before
// refetching. The local manifest is still read fresh and compared every call.
export const MANIFEST_DRIFT_TTL_MS = 30_000;

// Cap the drift-check fetch so a dead network degrades to the
// signatureMatches:true fallback instead of hanging the status probe.
export const MANIFEST_DRIFT_FETCH_TIMEOUT_MS = 5_000;

// Workers that pull from the pending-downloads queue in parallel. Higher = more
// concurrent sockets, lower = gentler on slow upstreams; 16 is the same value
// the launcher reference implementation settled on.
export const BUNDLE_DOWNLOAD_CONCURRENCY = 16;

// Cap follow-the-redirect hops per file. CMS uploads are usually direct, so
// 5 is plenty of slack for CDN-style edges (302 → 301 → 200).
export const BUNDLE_DOWNLOAD_MAX_REDIRECTS = 5;

export { PROGRESS_THROTTLE_MS as BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS } from '@shared/constants';

// Sliding window for instantaneous download speed (bytes/sec readout).
export const BUNDLE_DOWNLOAD_SPEED_WINDOW_MS = 1000;

// Per-request safety net so a stalled socket doesn't hang a sync forever.
export const BUNDLE_DOWNLOAD_REQUEST_TIMEOUT_MS = 60_000;

// How long a paused sync may sit idle before the manager auto-cancels it and
// frees the activeSyncs slot. Without this, "pause then never resume" wedges
// the slug for the rest of the session.
export const BUNDLE_PAUSED_SYNC_MAX_IDLE_MS = 5 * 60_000;

// How long getInstallState may reuse a previously fetched remote manifest hash
// before refetching. Bounds the per-IPC network round-trip without masking real
// drift for longer than the window — the local manifest is still read fresh and
// compared on every call.
export const MANIFEST_DRIFT_TTL_MS = 30_000;

// Cap the getInstallState drift-check fetch so a dead network degrades to the
// signatureMatches:true fallback promptly instead of hanging the status probe.
export const MANIFEST_DRIFT_FETCH_TIMEOUT_MS = 5_000;

// Workers that pull from the pending-downloads queue in parallel. Higher = more
// concurrent sockets, lower = gentler on slow upstreams; 16 is the same value
// the elixir-app reference implementation settled on.
export const BUNDLE_DOWNLOAD_CONCURRENCY = 16;

// Cap follow-the-redirect hops per file. Strapi uploads are usually direct, so
// 5 is plenty of slack for CDN-style edges (302 → 301 → 200).
export const BUNDLE_DOWNLOAD_MAX_REDIRECTS = 5;

// Throttle for renderer progress emissions. Lower = smoother bars, higher =
// fewer IPC round-trips. 100 ms is the smallest interval the human eye reads
// as "fluid".
export const BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS = 100;

// Sliding window for instantaneous download speed (bytes/sec readout).
export const BUNDLE_DOWNLOAD_SPEED_WINDOW_MS = 1000;

// Per-request safety net so a stalled socket doesn't hang a sync forever.
export const BUNDLE_DOWNLOAD_REQUEST_TIMEOUT_MS = 60_000;

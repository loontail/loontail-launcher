// Hidden per-client folder holding launcher-owned sidecar files (the bundle
// manifest and the target install manifest). Shared so a rename stays in one
// place — a mismatch would silently orphan a manifest on first read.
export const SIDECAR_DIR = '.loontail';

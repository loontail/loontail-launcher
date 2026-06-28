// Hidden per-client folder for launcher-owned sidecar files (bundle + target
// install manifests). A rename here would silently orphan manifests on read.
export const SIDECAR_DIR = '.loontail';

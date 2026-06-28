// Throttle for renderer progress emissions; ~100 ms reads as fluid while
// keeping IPC round-trips down.
export const PROGRESS_THROTTLE_MS = 100;

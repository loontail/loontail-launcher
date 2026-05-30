// Throttle for renderer progress emissions. Lower = smoother bars, higher =
// fewer IPC round-trips. 100 ms is the smallest interval the human eye reads
// as "fluid".
export const PROGRESS_THROTTLE_MS = 100;

// Min gap between automatic checks, so burst focus events don't spam the update endpoint.
const AUTO_CHECK_DEDUPE_MS = 5_000;

// Module state, not a store: nothing renders off these flags, so there is no
// subscription to pay for.
const tracking = { lastAutoCheckAt: Number.NEGATIVE_INFINITY, userInitiatedCheck: false };

export const markUserInitiated = (): void => {
  tracking.userInitiatedCheck = true;
};

export const clearUserInitiated = (): void => {
  tracking.userInitiatedCheck = false;
};

export const isUserInitiated = (): boolean => tracking.userInitiatedCheck;

export const claimAutoCheck = (now: number): boolean => {
  if (now - tracking.lastAutoCheckAt < AUTO_CHECK_DEDUPE_MS) return false;
  tracking.lastAutoCheckAt = now;
  return true;
};

export const resetCheckTracking = (): void => {
  tracking.lastAutoCheckAt = Number.NEGATIVE_INFINITY;
  tracking.userInitiatedCheck = false;
};

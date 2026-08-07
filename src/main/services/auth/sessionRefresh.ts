import { getStoredAuth, getStoredSessionToken, setStoredAuth } from '@main/infra/store';
import type { LoontailAuth, RefreshResult } from './loontailAuth';

// The single, de-duplicated path that rotates a Yggdrasil session. Rotation is
// single-use server-side (the new token revokes the old), so uncoordinated
// parallel refreshes with the same stale token would force a spurious re-login.
// `refresh()` memoizes the in-flight rotation and re-reads the stored token when
// it fires, so concurrent callers share one round-trip and never rotate a token
// that was already replaced. Both http.ts and verifySession route through the
// same instance.
export type SessionRefresher = {
  refresh: () => Promise<RefreshResult>;
};

const REFRESH_NOOP: RefreshResult = { kind: 'expired' };

export const createSessionRefresher = (loontailAuth: LoontailAuth): SessionRefresher => {
  let refreshing: Promise<RefreshResult> | null = null;

  const runRefresh = async (): Promise<RefreshResult> => {
    // Re-read when the rotation fires: a concurrent refresh or login may have
    // already rotated the session, so use the freshest stored token.
    const session = getStoredAuth();
    const token = getStoredSessionToken();
    if (session?.provider !== 'yggdrasil' || !token) return REFRESH_NOOP;

    const result = await loontailAuth.refresh(token);
    if (result.kind === 'ok') {
      setStoredAuth(result.identity.session, result.identity.apiSession);
    }
    return result;
  };

  const refresh = (): Promise<RefreshResult> => {
    if (refreshing) return refreshing;
    refreshing = runRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  return { refresh };
};

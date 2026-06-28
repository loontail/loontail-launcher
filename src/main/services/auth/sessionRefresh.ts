import { getStoredAuth, getStoredSessionToken, setStoredAuth } from '@main/infra/store';
import type { LoontailAuth, RefreshResult } from './loontailAuth';

// The single, de-duplicated path that rotates a Yggdrasil session.
//
// Session rotation is single-use server-side: the moment the server hands back a
// new token, the old one is revoked. Without coordination, parallel session
// requests that all see the same stale token each POST /auth/refresh with it —
// the first rotates it, the rest hit the now-revoked token and get `expired`,
// spuriously forcing a re-login (BUG-1). A refresh racing a login's
// setStoredAuth could likewise clobber the fresh session.
//
// `refresh()` memoizes the in-flight rotation so concurrent callers share one
// network round-trip and one setStoredAuth, and re-reads the current stored
// token at the moment it actually fires so it never rotates with a token that
// was already replaced underneath it. Both http.ts and verifySession route
// through the same instance.
export type SessionRefresher = {
  refresh: () => Promise<RefreshResult>;
};

const REFRESH_NOOP: RefreshResult = { kind: 'expired' };

export const createSessionRefresher = (loontailAuth: LoontailAuth): SessionRefresher => {
  let refreshing: Promise<RefreshResult> | null = null;

  const runRefresh = async (): Promise<RefreshResult> => {
    // Re-read at the moment the rotation fires: an earlier concurrent refresh
    // (or a login) may have already rotated the session while this call was
    // queued, so use the freshest stored token, not a caller's snapshot.
    const session = getStoredAuth();
    const token = getStoredSessionToken();
    if (session?.provider !== 'yggdrasil' || !token) return REFRESH_NOOP;

    const result = await loontailAuth.refresh(token);
    if (result.kind === 'ok') {
      setStoredAuth(result.identity.session, result.identity.sessionToken);
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

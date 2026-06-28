import {
  clearStoredAuth,
  getStoredAuth,
  getStoredSessionToken,
  setStoredAuth,
} from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type { YggdrasilSession } from '@shared/contracts/auth';
import type { MojangAuth } from './mojangAuth';
import type { SessionRefresher } from './sessionRefresh';
import type { FetchTextures } from './yggdrasilClient';

import { scopedLogger } from '@main/infra/logger';

const logger = scopedLogger('auth.verify');

// Skin and cape URLs come from the native textures endpoint
// (GET /textures/:uuid on the API origin, via `fetchTextures`), session-gated
// like every other API read. `email` comes from the login/refresh response, so
// a bare session keeps it null until the next successful authentication.
export const enrichYggdrasilAccount = async (
  session: YggdrasilSession,
  fallback: Account,
  fetchTextures: FetchTextures,
): Promise<Account> => {
  try {
    const textures = await fetchTextures(session.profile.uuid);
    return {
      ...fallback,
      skin: textures.skin?.url ?? null,
      cape: textures.cape?.url ?? null,
    };
  } catch (error) {
    logger.warn('Yggdrasil texture enrichment failed — falling back to bare profile', error);
    return fallback;
  }
};

// Provider-agnostic session check. Returns the active account on success,
// `null` if no session is stored or the server invalidated it, and the
// cached account if the network is unavailable (offline fallback).
//
// Yggdrasil verification rotates the session via the shared `SessionRefresher`
// (POST /api/auth/refresh) so it is de-duplicated against the HTTP layer's
// refresh-and-retry and never double-rotates a single-use token: a success has
// already persisted the new tokens (the refresher owns setStoredAuth), so this
// only enriches the account; an `expired` result clears the session; an
// `offline` result keeps the cached account.
export const verifySession = async (
  refresher: SessionRefresher,
  mojangAuth: MojangAuth,
  fetchTextures: FetchTextures,
): Promise<Account | null> => {
  const session = getStoredAuth();
  if (session === null) return null;

  if (session.provider === 'yggdrasil') {
    const sessionToken = getStoredSessionToken();
    if (!sessionToken) {
      // No API bearer for a Yggdrasil session: unusable, force a re-login.
      clearStoredAuth();
      return null;
    }
    const result = await refresher.refresh();
    if (result.kind === 'expired') {
      clearStoredAuth();
      return null;
    }
    if (result.kind === 'offline') {
      // Offline fallback must be instant: enrichment hits the same unreachable
      // server, so reuse the bare account derived from the stored session.
      return accountFromSession(session);
    }
    const { identity } = result;
    return enrichYggdrasilAccount(identity.session, identity.account, fetchTextures);
  }

  const result = await mojangAuth.verifyMojangSession(session);
  if (result.kind === 'expired') {
    clearStoredAuth();
    return null;
  }
  if (result.kind === 'offline') return accountFromSession(session);
  setStoredAuth(result.session);
  return accountFromSession(result.session);
};

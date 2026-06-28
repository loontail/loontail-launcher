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

// Skin and cape URLs come from the textures endpoint (via `fetchTextures`);
// `email` comes from the login/refresh response, so a bare session keeps it null
// until the next successful authentication.
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

// Provider-agnostic session check: active account on success, `null` if no
// session is stored or the server invalidated it, cached account when offline.
// Yggdrasil verification rotates via the shared `SessionRefresher` so it is
// de-duplicated against the HTTP layer and never double-rotates a single-use
// token; on success the refresher has already persisted the new tokens, so this
// only enriches the account.
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

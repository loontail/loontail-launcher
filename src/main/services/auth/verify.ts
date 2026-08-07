import { scopedLogger } from '@main/infra/logger';
import {
  clearStoredAuth,
  getStoredApiSession,
  getStoredAuth,
  setStoredAuth,
} from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type { YggdrasilSession } from '@shared/contracts/auth';
import type { ValidateSession } from './loontailAuth';
import type { MojangAuth } from './mojangAuth';
import type { SessionRefresher } from './sessionRefresh';
import type { FetchTextures } from './yggdrasilClient';

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

// Rotation is destructive server-side and the running game holds a frozen copy
// of the bearer, so a rotation kills its in-game networking until relaunch
// (CON-06). Only rotate once the session is genuinely close to expiry; the
// server TTL is 24 h, so this leaves at most one rotation per ~18 h of use.
const SESSION_ROTATION_THRESHOLD_MS = 6 * 60 * 60 * 1000;

// A null expiry means the stored blob predates expiry tracking: rotate once to
// learn the real one rather than assume the session is fresh.
const needsRotation = (expiresAt: number | null): boolean =>
  expiresAt === null || expiresAt - Date.now() <= SESSION_ROTATION_THRESHOLD_MS;

// Provider-agnostic session check: active account on success, `null` if no
// session is stored or the server invalidated it, cached account when offline.
// A Yggdrasil session far from expiry is validated non-destructively via
// `validateSession`; otherwise it rotates through the shared `SessionRefresher`
// so the rotation is de-duplicated against the HTTP layer and a single-use token
// is never rotated twice. On rotation the refresher has already persisted the
// new tokens, so this only enriches the account.
export const verifySession = async (
  refresher: SessionRefresher,
  validateSession: ValidateSession,
  mojangAuth: MojangAuth,
  fetchTextures: FetchTextures,
): Promise<Account | null> => {
  const session = getStoredAuth();
  if (session === null) return null;

  if (session.provider === 'yggdrasil') {
    const apiSession = getStoredApiSession();
    if (!apiSession) {
      // No API bearer for a Yggdrasil session: unusable, force a re-login.
      clearStoredAuth();
      return null;
    }
    if (!needsRotation(apiSession.expiresAt)) {
      const validation = await validateSession(apiSession.token);
      if (validation.kind === 'ok') {
        return enrichYggdrasilAccount(session, validation.account, fetchTextures);
      }
      // Offline keeps the cached session; a rejection falls through to a
      // rotation attempt, which re-reads the freshest stored token and so
      // survives a concurrent rotation that revoked the one just presented.
      if (validation.kind === 'offline') return accountFromSession(session);
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

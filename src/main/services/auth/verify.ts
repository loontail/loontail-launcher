import { scopedLogger } from '@main/infra/logger';
import { clearStoredAuth, getStoredAuth, setStoredAuth } from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type { YggdrasilSession } from '@shared/contracts/auth';
import type { MojangAuth } from './mojangAuth';
import type { YggdrasilAuth } from './yggdrasilAuth';
import type { FetchTextures } from './yggdrasilClient';

const logger = scopedLogger('auth.verify');

// After the skins-registry → yggdrasil-plugin merge both URLs come from
// GET /api/yggdrasil/textures/:uuid, so no static Strapi token is needed.
// `email` is not part of the Yggdrasil protocol and stays null for these accounts.
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
// Each provider's verify helper distinguishes "definitely expired"
// (403/401-equivalent) from "couldn't reach the server" — only the former
// clears the stored session.
export const verifySession = async (
  yggdrasilAuth: YggdrasilAuth,
  mojangAuth: MojangAuth,
  fetchTextures: FetchTextures,
): Promise<Account | null> => {
  const session = getStoredAuth();
  if (session === null) return null;

  if (session.provider === 'yggdrasil') {
    const result = await yggdrasilAuth.verifySession(session);
    if (result.kind === 'expired') {
      clearStoredAuth();
      return null;
    }
    if (result.kind === 'offline') {
      // Offline fallback must be instant: enrichment hits the same unreachable
      // server, so reuse the skin/cape persisted from the last successful verify.
      return accountFromSession(session);
    }
    if (result.kind === 'server-error') {
      // The server answered but faulted, so validity is undetermined. Keep the
      // cached session rather than clearing it on a transient 5xx, but log
      // distinctly from the offline path so the failure stays actionable.
      logger.warn('Yggdrasil verify hit a server error — reusing cached session');
      return accountFromSession(session);
    }
    setStoredAuth(result.session);
    return enrichYggdrasilAccount(
      result.session,
      accountFromSession(result.session),
      fetchTextures,
    );
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

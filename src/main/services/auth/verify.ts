import { clearStoredAuth, getStoredAuth, setStoredAuth } from '@main/infra/store';
import { type Account, accountFromSession } from '@shared/contracts/account';
import type { MojangAuth } from './mojangAuth';
import { verifyStrapi } from './strapiAuth';

// Provider-agnostic session check. Returns the active account on success,
// `null` if no session is stored or the server invalidated it, and the
// cached account if the network is unavailable (offline fallback).
//
// Each provider's verify helper distinguishes "definitely expired"
// (401-equivalent) from "couldn't reach the server" — only the former clears
// the stored session.
export const verifySession = async (mojangAuth: MojangAuth): Promise<Account | null> => {
  const session = getStoredAuth();
  if (session === null) return null;

  if (session.provider === 'strapi') {
    const result = await verifyStrapi(session);
    if (result.kind === 'expired') {
      clearStoredAuth();
      return null;
    }
    if (result.kind === 'offline') return accountFromSession(session);
    setStoredAuth(result.session);
    return accountFromSession(result.session);
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

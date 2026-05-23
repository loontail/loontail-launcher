import {
  FetchHttpClient,
  MinecraftKit,
  asAzureClientId,
  isErrorCode,
} from '@loontail/minecraft-kit';
import type { MojangSession as KitMojangSession, MinecraftProfile } from '@loontail/minecraft-kit';
import { mainConfig } from '@main/config';
import { kitLogger, scopedLogger } from '@main/infra/logger';
import type { MojangSession } from '@shared/contracts/auth';
import { shell } from 'electron';

const logger = scopedLogger('auth.mojang');

// One in-flight sign-in at a time. A second click while the browser flow is
// outstanding aborts the previous attempt so the launcher doesn't leak
// loopback servers.
let activeController: AbortController | null = null;
const kit = new MinecraftKit({ logger: kitLogger('kit.auth') });
// Reused for direct `/minecraft/profile` pings to confirm a cached access
// token still works without spending a refresh token.
const http = new FetchHttpClient();

const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile';

const requireClientId = () => {
  if (!mainConfig.mojangClientId) {
    throw new Error(
      'MOJANG_CLIENT_ID is not configured — Microsoft sign-in is unavailable in this build',
    );
  }
  return asAzureClientId(mainConfig.mojangClientId);
};

// Project the kit's nested session into the launcher's flat storage shape.
// The kit returns the active profile inline, so no second `/minecraft/profile`
// call is needed.
const fromKitSession = (kitSession: KitMojangSession): MojangSession => ({
  provider: 'mojang',
  accessToken: kitSession.minecraft.accessToken,
  expiresAt: kitSession.minecraft.expiresAt,
  refreshToken: kitSession.microsoft.refreshToken,
  clientId: kitSession.microsoft.clientId,
  xuid: kitSession.minecraft.xuid,
  profile: {
    uuid: kitSession.minecraft.uuid,
    username: kitSession.minecraft.username,
    skins: [...kitSession.minecraft.skins],
  },
});

/**
 * Run the OAuth Authorization Code + PKCE flow end-to-end via the kit. The kit
 * binds a temporary loopback HTTP server, we hand it `shell.openExternal` as the
 * browser opener, and the call blocks until the user finishes signing in or
 * cancels. One concurrent flow at a time — a fresh call aborts the prior one.
 */
export const signInWithMojang = async (): Promise<MojangSession> => {
  const clientId = requireClientId();
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const startedAt = Date.now();
  logger.info('Mojang sign-in: started');
  try {
    const kitSession = await kit.auth.authorizationCode.run({
      clientId,
      onOpenBrowser: (url) => {
        void shell.openExternal(url);
      },
      signal: controller.signal,
    });
    const session = fromKitSession(kitSession);
    logger.info(
      `Mojang sign-in: signed in as ${session.profile.username} in ${Date.now() - startedAt}ms`,
    );
    return session;
  } catch (error) {
    if (isErrorCode(error, 'AUTH_CANCELLED')) {
      logger.info(`Mojang sign-in: cancelled after ${Date.now() - startedAt}ms`);
    } else {
      logger.warn(`Mojang sign-in: failed after ${Date.now() - startedAt}ms`, error);
    }
    throw error;
  } finally {
    if (activeController === controller) activeController = null;
  }
};

/** Aborts the in-flight `signInWithMojang` flow, if any. Idempotent. */
export const cancelMojangLogin = (): void => {
  activeController?.abort();
  activeController = null;
};

/**
 * Apply a fresh kit-provided profile snapshot to the stored session.
 * Mojang `profile.*` mutations already return the updated profile, so the
 * caller passes it in instead of triggering another GET.
 */
export const withRefreshedProfile = (
  session: MojangSession,
  profile: MinecraftProfile,
): MojangSession => ({
  ...session,
  profile: {
    uuid: profile.uuid,
    username: profile.username,
    skins: [...profile.skins],
  },
});

type RawProfile = {
  readonly id: string;
  readonly name: string;
  readonly skins?: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly state: 'ACTIVE' | 'INACTIVE';
    readonly variant: 'CLASSIC' | 'SLIM';
  }>;
};

/**
 * Validate a stored Mojang session. Refreshes the access token if it's near
 * expiry, then pings `/minecraft/profile` to confirm the token still works
 * server-side. `expired` clears the session, `offline` keeps the cached copy.
 */
export const verifyMojangSession = async (
  session: MojangSession,
): Promise<{ kind: 'ok'; session: MojangSession } | { kind: 'expired' } | { kind: 'offline' }> => {
  const safetyWindowMs = 60_000;
  const needsRefresh = Date.now() > session.expiresAt - safetyWindowMs;

  try {
    if (needsRefresh) {
      const refreshed = await kit.auth.refresh(session.refreshToken, {
        clientId: session.clientId,
      });
      return { kind: 'ok', session: fromKitSession(refreshed) };
    }
    const response = await http.request(PROFILE_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${session.accessToken}` },
      acceptNonOk: true,
    });
    if (response.status === 401) return { kind: 'expired' };
    if (response.status >= 400) {
      logger.warn(`Mojang verify: non-OK HTTP ${response.status} — assuming offline`);
      return { kind: 'offline' };
    }
    const raw = (await response.json()) as RawProfile;
    const next: MojangSession = {
      ...session,
      profile: {
        uuid: session.profile.uuid,
        username: raw.name,
        skins:
          raw.skins?.map((s) => ({
            id: s.id,
            url: s.url,
            state: s.state,
            variant: s.variant,
          })) ?? [],
      },
    };
    return { kind: 'ok', session: next };
  } catch (error) {
    if (isErrorCode(error, 'AUTH_REFRESH_FAILED')) return { kind: 'expired' };
    logger.warn('Mojang verify failed — assuming offline', error);
    return { kind: 'offline' };
  }
};

import { asAzureClientId, isErrorCode, isMinecraftKitError } from '@loontail/minecraft-kit';
import type { MojangSession as KitMojangSession, MinecraftKit } from '@loontail/minecraft-kit';
import { mainConfig } from '@main/config';
import { HTTP_UNAUTHORIZED } from '@main/constants/http';
import { scopedLogger } from '@main/infra/logger';
import type { MojangSession } from '@shared/contracts/auth';
import { shell } from 'electron';
import { withRefreshedProfile } from './session';

const logger = scopedLogger('auth.mojang');
// The kit's authorize URL is built for Microsoft personal accounts only.
// Keep this host/path allowlist narrow before crossing Electron's shell boundary.
const MICROSOFT_AUTHORIZE_HOST = 'login.microsoftonline.com';
const MICROSOFT_AUTHORIZE_PATH = '/consumers/oauth2/v2.0/authorize';
export const MOJANG_BROWSER_OPEN_ERROR_CODE = 'MOJANG_BROWSER_OPEN_FAILED';
// Refresh the access token this far ahead of its stated expiry to absorb clock
// skew and the round-trip cost of the MSAL refresh + profile read.
const MOJANG_TOKEN_REFRESH_SAFETY_WINDOW_MS = 60_000;

type BrowserOpener = (url: string) => Promise<void>;

export class MojangBrowserOpenError extends Error {
  readonly code = MOJANG_BROWSER_OPEN_ERROR_CODE;

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MojangBrowserOpenError';
  }
}

export type MojangAuthOptions = {
  readonly openExternal?: BrowserOpener;
};

const requireClientId = () => {
  if (!mainConfig.mojangClientId) {
    throw new Error(
      'MOJANG_CLIENT_ID is not configured — Microsoft sign-in is unavailable in this build',
    );
  }
  return asAzureClientId(mainConfig.mojangClientId);
};

// The kit returns the active profile inline, so no second `/minecraft/profile` call is needed.
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

export type VerifyMojangResult =
  | { kind: 'ok'; session: MojangSession }
  | { kind: 'expired' }
  | { kind: 'offline' };

export type MojangAuth = {
  signInWithMojang: () => Promise<MojangSession>;
  cancelMojangLogin: () => void;
  verifyMojangSession: (session: MojangSession) => Promise<VerifyMojangResult>;
};

const parseUrl = (raw: string): URL | null => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

const isMicrosoftAuthorizeUrl = (raw: string): boolean => {
  const parsed = parseUrl(raw);
  if (!parsed) return false;
  if (parsed.protocol !== 'https:') return false;
  return (
    parsed.hostname.toLowerCase() === MICROSOFT_AUTHORIZE_HOST &&
    parsed.pathname === MICROSOFT_AUTHORIZE_PATH
  );
};

const openMicrosoftAuthorizeUrl = async (
  rawUrl: string,
  openExternal: BrowserOpener,
  controller: AbortController,
): Promise<void> => {
  if (!isMicrosoftAuthorizeUrl(rawUrl)) {
    const error = new MojangBrowserOpenError('Refusing to open unexpected Microsoft sign-in URL');
    controller.abort(error);
    throw error;
  }

  try {
    await openExternal(rawUrl);
  } catch (cause) {
    const error = new MojangBrowserOpenError(
      'Failed to open the system browser for Microsoft sign-in',
      { cause },
    );
    controller.abort(error);
    throw error;
  }
};

export const createMojangAuth = (
  kit: MinecraftKit,
  options: MojangAuthOptions = {},
): MojangAuth => {
  // One in-flight sign-in at a time. A second click while the browser flow is
  // outstanding aborts the previous attempt so the launcher doesn't leak
  // loopback servers.
  let activeController: AbortController | null = null;
  const openExternal = options.openExternal ?? ((url: string) => shell.openExternal(url));

  const signInWithMojang = async (): Promise<MojangSession> => {
    const clientId = requireClientId();
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const startedAt = Date.now();
    logger.info('Mojang sign-in: started');
    try {
      const kitSession = await kit.auth.authorizationCode.run({
        clientId,
        onOpenBrowser: (url) => openMicrosoftAuthorizeUrl(url, openExternal, controller),
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

  const cancelMojangLogin = (): void => {
    activeController?.abort();
    activeController = null;
  };

  const verifyMojangSession = async (session: MojangSession): Promise<VerifyMojangResult> => {
    const needsRefresh = Date.now() > session.expiresAt - MOJANG_TOKEN_REFRESH_SAFETY_WINDOW_MS;

    try {
      if (needsRefresh) {
        const refreshed = await kit.auth.refresh(session.refreshToken, {
          clientId: session.clientId,
        });
        return { kind: 'ok', session: fromKitSession(refreshed) };
      }
      const profile = await kit.auth.profile.read({ accessToken: session.accessToken });
      return { kind: 'ok', session: withRefreshedProfile(session, profile) };
    } catch (error) {
      if (isErrorCode(error, 'AUTH_REFRESH_FAILED')) return { kind: 'expired' };
      if (
        isMinecraftKitError(error) &&
        error.code === 'AUTH_MINECRAFT_FAILED' &&
        error.context.httpStatus === HTTP_UNAUTHORIZED
      ) {
        return { kind: 'expired' };
      }
      logger.warn('Mojang verify failed — assuming offline', error);
      return { kind: 'offline' };
    }
  };

  return { signInWithMojang, cancelMojangLogin, verifyMojangSession };
};

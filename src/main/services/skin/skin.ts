import {
  detectSkinVariant,
  isMinecraftKitError,
  type MinecraftKit,
  type MinecraftProfile,
} from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import type { AuthSessionPort } from '@main/services/auth/session';
import type { FetchTextures, YggdrasilGateway } from '@main/services/auth/yggdrasilClient';
import { invalidateMediaCache, prewarmMediaCache } from '@main/services/media/mediaCache';
import type { AuthSession, MojangSession, YggdrasilSession } from '@shared/contracts/auth';
import {
  SkinErrorCodes,
  type SkinKind,
  SkinKinds,
  type UploadSkinPayload,
  type UploadSkinResult,
} from '@shared/contracts/skin';
import { type SkinAssetKind, validatePngBuffer } from '@shared/yggdrasil/png';
import { SkinError } from './errors';

const logger = scopedLogger('skin');

// Caps a hand-crafted buffer with a valid PNG header but megabytes of trailing
// chunks (validatePngBuffer only reads the header). A real skin is a few KB.
const MAX_TEXTURE_BYTES = 256 * 1024;

// Fails tsc if our SkinKind ever diverges from the SkinAssetKind that
// validatePngBuffer requires.
type SkinKindMatchesAsset = SkinKind extends SkinAssetKind
  ? true
  : ['SkinKind diverged from SkinAssetKind'];
const _skinKindAssetCheck: SkinKindMatchesAsset = true;
void _skinKindAssetCheck;

const requireSession = (authSession: AuthSessionPort): AuthSession => {
  const session = authSession.current();
  if (!session) {
    throw new SkinError(SkinErrorCodes.NOT_AUTHENTICATED, 'No authenticated user');
  }
  return session;
};

// "Authenticated for textures" is one rule, not one per handler: a Yggdrasil
// session additionally needs the live bearer, a Mojang session carries its own
// access token. Resolved once so a change to the precondition lands in one place.
type SkinAuth =
  | { provider: 'yggdrasil'; session: YggdrasilSession; sessionToken: string }
  | { provider: 'mojang'; session: MojangSession };

const resolveSkinAuth = (authSession: AuthSessionPort): SkinAuth => {
  const session = requireSession(authSession);
  if (session.provider !== 'yggdrasil') return { provider: 'mojang', session };
  const sessionToken = authSession.sessionToken();
  if (!sessionToken) {
    throw new SkinError(SkinErrorCodes.NOT_AUTHENTICATED, 'No active session');
  }
  return { provider: 'yggdrasil', session, sessionToken };
};

const throwUploadError = (prefix: string, error: unknown): never => {
  throw new SkinError(SkinErrorCodes.UPLOAD_FAILED, `${prefix}: ${errorMessage(error)}`);
};

// Pull Mojang's human-readable `errorMessage` (or `details.status`) so the toast
// shows e.g. "Banned skin image" instead of a raw JSON dump.
const extractMojangMessage = (error: unknown): string | null => {
  if (!isMinecraftKitError(error)) return null;
  const body = error.context.responseBody;
  if (typeof body !== 'string' || body.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const message = obj.errorMessage;
      if (typeof message === 'string' && message.length > 0) return message;
      const details = obj.details;
      if (details && typeof details === 'object') {
        const status = (details as Record<string, unknown>).status;
        if (typeof status === 'string' && status.length > 0) return status;
      }
    }
  } catch {
    // Body wasn't JSON — fall through to caller's default.
  }
  return null;
};

const throwMojangUploadError = (error: unknown): never => {
  const mojangMessage = extractMojangMessage(error);
  if (mojangMessage !== null) {
    throw new SkinError(SkinErrorCodes.UPLOAD_FAILED, `Mojang: ${mojangMessage}`);
  }
  return throwUploadError('Mojang skin upload failed', error);
};

const activeMojangSkinUrl = (session: MojangSession): string | null =>
  session.profile.skins.find((s) => s.state === 'ACTIVE')?.url ?? null;

const readTextureUrl = (
  textures: { skin: { url: string } | null; cape: { url: string } | null },
  kind: typeof SkinKinds.SKIN | typeof SkinKinds.CAPE,
): string | null => (kind === SkinKinds.SKIN ? textures.skin?.url : textures.cape?.url) ?? null;

const POST_UPLOAD_TEXTURE_RETRY_ATTEMPTS = 3;
const POST_UPLOAD_TEXTURE_RETRY_DELAY_MS = 200;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A freshly uploaded texture can lag the textures endpoint while the CDN
// propagates the new revision, so retry before declaring the upload URL-less.
const fetchUploadedTextureUrl = async (
  uuid: string,
  kind: typeof SkinKinds.SKIN | typeof SkinKinds.CAPE,
  fetchTextures: FetchTextures,
): Promise<string | null> => {
  for (let attempt = 0; attempt < POST_UPLOAD_TEXTURE_RETRY_ATTEMPTS; attempt += 1) {
    const textures = await fetchTextures(uuid).catch(() => null);
    const url = textures ? readTextureUrl(textures, kind) : null;
    if (url) return url;
    if (attempt < POST_UPLOAD_TEXTURE_RETRY_ATTEMPTS - 1) {
      await delay(POST_UPLOAD_TEXTURE_RETRY_DELAY_MS);
    }
  }
  return null;
};

// Texture endpoints authenticate with the session bearer that identifies the
// owner — NOT the in-game `accessToken` (that only feeds the authlib-injector
// handshake).
const uploadSkinYggdrasil = async (
  session: YggdrasilSession,
  payload: UploadSkinPayload,
  gateway: YggdrasilGateway,
  sessionToken: string,
): Promise<UploadSkinResult> => {
  const { texturesClient, fetchTextures } = gateway;
  const buffer = Buffer.from(payload.buffer);

  // Capture the previous URL before upload to invalidate the media cache once
  // the new revision lands. Failures here are non-fatal (stale PNG until TTL).
  const previousTextures = await fetchTextures(session.profile.uuid).catch(() => null);
  const previousUrl = previousTextures ? readTextureUrl(previousTextures, payload.type) : null;

  try {
    if (payload.type === SkinKinds.SKIN) {
      const variant = detectSkinVariant(new Uint8Array(payload.buffer));
      await texturesClient.uploadSkin({
        accessToken: sessionToken,
        file: buffer,
        variant,
      });
    } else {
      await texturesClient.uploadCape({ accessToken: sessionToken, file: buffer });
    }
  } catch (error) {
    logger.error('Yggdrasil texture upload failed', { kind: payload.type, error });
    return throwUploadError('Upload to Yggdrasil failed', error);
  }

  const updatedUrl = await fetchUploadedTextureUrl(
    session.profile.uuid,
    payload.type,
    fetchTextures,
  );
  if (!updatedUrl) {
    throw new SkinError(
      SkinErrorCodes.UPLOAD_NO_URL,
      'Server accepted the upload but did not return an URL',
    );
  }
  await prewarmMediaCache(updatedUrl, buffer);
  if (previousUrl && previousUrl !== updatedUrl) {
    await invalidateMediaCache(previousUrl);
  }
  return { url: updatedUrl };
};

export type SkinHandlers = {
  uploadSkin: (payload: UploadSkinPayload) => Promise<UploadSkinResult>;
  clearSkin: () => Promise<void>;
};

export const createSkinHandlers = (
  kit: MinecraftKit,
  gateway: YggdrasilGateway,
  authSession: AuthSessionPort,
): SkinHandlers => {
  const uploadSkinMojang = async (
    session: MojangSession,
    payload: UploadSkinPayload,
  ): Promise<UploadSkinResult> => {
    if (payload.type !== SkinKinds.SKIN) {
      throw new SkinError(
        SkinErrorCodes.CAPE_UNSUPPORTED,
        'Mojang accounts cannot upload custom capes',
      );
    }
    const skin = new Uint8Array(payload.buffer);
    // why: kit requires a literal variant type; 'AUTO' = detect slim/classic from PNG dimensions
    const variant = 'AUTO' as const;
    let profile: MinecraftProfile;
    try {
      profile = await kit.auth.profile.uploadSkin({
        accessToken: session.accessToken,
        skin,
        variant,
      });
    } catch (error) {
      logger.error('Mojang skin upload failed', error);
      return throwMojangUploadError(error);
    }

    const refreshed = authSession.updateMojangProfile(session, profile);
    const url = activeMojangSkinUrl(refreshed);
    if (url === null) {
      throw new SkinError(
        SkinErrorCodes.UPLOAD_NO_URL,
        'Mojang accepted the upload but did not return an active skin URL',
      );
    }
    await prewarmMediaCache(url, Buffer.from(skin));
    return { url };
  };

  const uploadSkin = async (payload: UploadSkinPayload): Promise<UploadSkinResult> => {
    if (payload.buffer.byteLength > MAX_TEXTURE_BYTES) {
      throw new SkinError(SkinErrorCodes.INVALID_IMAGE, 'Texture exceeds the maximum allowed size');
    }
    const verdict = validatePngBuffer(payload.buffer, payload.type);
    if (!verdict.ok) {
      throw new SkinError(SkinErrorCodes.INVALID_IMAGE, verdict.reason);
    }
    const auth = resolveSkinAuth(authSession);
    if (auth.provider === 'yggdrasil') {
      return uploadSkinYggdrasil(auth.session, payload, gateway, auth.sessionToken);
    }
    return uploadSkinMojang(auth.session, payload);
  };

  const clearSkin = async (): Promise<void> => {
    const auth = resolveSkinAuth(authSession);
    if (auth.provider === 'yggdrasil') {
      const { session, sessionToken } = auth;
      const { texturesClient, fetchTextures } = gateway;
      // Snapshot the URLs before deleting so we can invalidate the cache.
      const before = await fetchTextures(session.profile.uuid).catch(() => null);
      try {
        await Promise.all([
          texturesClient.deleteSkin({ accessToken: sessionToken }),
          texturesClient.deleteCape({ accessToken: sessionToken }),
        ]);
      } catch (error) {
        logger.error('Failed to clear textures on Yggdrasil server', error);
        throw new SkinError(
          SkinErrorCodes.CLEAR_FAILED,
          `Failed to clear textures: ${errorMessage(error)}`,
        );
      }
      if (before?.skin?.url) await invalidateMediaCache(before.skin.url);
      if (before?.cape?.url) await invalidateMediaCache(before.cape.url);
      return;
    }

    // Mojang exposes no cape management to launchers, so only the skin resets.
    try {
      const profile = await kit.auth.profile.resetSkin({ accessToken: auth.session.accessToken });
      authSession.updateMojangProfile(auth.session, profile);
    } catch (error) {
      logger.error('Failed to reset Mojang skin', error);
      throw new SkinError(
        SkinErrorCodes.CLEAR_FAILED,
        `Failed to clear skin: ${errorMessage(error)}`,
      );
    }
  };

  return { uploadSkin, clearSkin };
};

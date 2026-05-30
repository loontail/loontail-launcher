import {
  type MinecraftKit,
  type MinecraftProfile,
  detectSkinVariant,
  isMinecraftKitError,
} from '@loontail/minecraft-kit';
import { validatePngBuffer } from '@loontail/yggdrasil-core';
import { scopedLogger } from '@main/infra/logger';
import { getStoredAuth, setStoredAuth } from '@main/infra/store';
import { withRefreshedProfile } from '@main/services/auth/mojangAuth';
import { fetchTextures, getYggdrasilClient } from '@main/services/auth/yggdrasilClient';
import { invalidateMediaCache, prewarmMediaCache } from '@main/services/media/mediaCache';
import { ERROR_CODES } from '@shared/constants';
import type { AuthSession, MojangSession, YggdrasilSession } from '@shared/contracts/auth';
import { SkinKinds, type UploadSkinPayload, type UploadSkinResult } from '@shared/contracts/skin';
import { SkinError } from './errors';

const logger = scopedLogger('skin');

const requireSession = (): AuthSession => {
  const session = getStoredAuth();
  if (!session) {
    throw new SkinError(ERROR_CODES.SkinNotAuthenticated, 'No authenticated user');
  }
  return session;
};

const throwUploadError = (prefix: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  throw new SkinError(ERROR_CODES.SkinUploadFailed, `${prefix}: ${message}`);
};

// Mojang's profile-mutation errors come back as JSON like:
//   { "path": "...", "details": { "status": "BANNED_SKIN" }, "errorMessage": "Banned skin image" }
// Pull the human-readable `errorMessage` (preferred) or `details.status` so
// the toast surfaces "Banned skin image" instead of a raw JSON dump.
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
    throw new SkinError(ERROR_CODES.SkinUploadFailed, `Mojang: ${mojangMessage}`);
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

// A freshly uploaded texture can lag behind the server's textures endpoint
// while the CDN propagates the new revision, so the immediate lookup may still
// return no URL. Retry a few times before declaring the upload URL-less.
const fetchUploadedTextureUrl = async (
  uuid: string,
  kind: typeof SkinKinds.SKIN | typeof SkinKinds.CAPE,
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

// Yggdrasil flow: the launcher-side session already carries the access token
// the merged Yggdrasil plugin needs to authorise the upload. The server
// identifies the owner from the token; we only have to push the PNG and
// later fetch the new URL for media-cache pre-warming.
const uploadSkinYggdrasil = async (
  session: YggdrasilSession,
  payload: UploadSkinPayload,
): Promise<UploadSkinResult> => {
  const client = getYggdrasilClient();
  const buffer = Buffer.from(payload.buffer);

  // Capture the previous URL before the upload so we can invalidate the
  // launcher's media cache once the new revision lands. Failures here are
  // not fatal — worst case the old PNG lingers in the cache until TTL.
  const previousTextures = await fetchTextures(session.profile.uuid).catch(() => null);
  const previousUrl = previousTextures ? readTextureUrl(previousTextures, payload.type) : null;

  try {
    if (payload.type === SkinKinds.SKIN) {
      const variant = detectSkinVariant(new Uint8Array(payload.buffer));
      await client.uploadSkin({
        accessToken: session.accessToken,
        file: buffer,
        variant,
      });
    } else {
      await client.uploadCape({ accessToken: session.accessToken, file: buffer });
    }
  } catch (error) {
    logger.error('Yggdrasil texture upload failed', { kind: payload.type, error });
    return throwUploadError('Upload to Yggdrasil failed', error);
  }

  const updatedUrl = await fetchUploadedTextureUrl(session.profile.uuid, payload.type);
  if (!updatedUrl) {
    throw new SkinError(
      ERROR_CODES.SkinUploadFailed,
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

export const createSkinHandlers = (kit: MinecraftKit): SkinHandlers => {
  // Mojang flow: hand the PNG to `kit.auth.profile.uploadSkin`, which posts
  // it to api.minecraftservices.com/minecraft/profile/skins. Kit errors now
  // include Mojang's response body in the message (kit 0.8.8+), so
  // user-visible toasts surface the real reason.
  const uploadSkinMojang = async (
    session: MojangSession,
    payload: UploadSkinPayload,
  ): Promise<UploadSkinResult> => {
    if (payload.type !== SkinKinds.SKIN) {
      throw new SkinError(
        ERROR_CODES.SkinUploadFailed,
        'Mojang accounts cannot upload custom capes',
      );
    }
    const skin = new Uint8Array(payload.buffer);
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

    const refreshed = withRefreshedProfile(session, profile);
    setStoredAuth(refreshed);
    const url = activeMojangSkinUrl(refreshed);
    if (url === null) {
      throw new SkinError(
        ERROR_CODES.SkinUploadFailed,
        'Mojang accepted the upload but did not return an active skin URL',
      );
    }
    await prewarmMediaCache(url, Buffer.from(skin));
    return { url };
  };

  const uploadSkin = async (payload: UploadSkinPayload): Promise<UploadSkinResult> => {
    const verdict = validatePngBuffer(payload.buffer, payload.type);
    if (!verdict.ok) {
      throw new SkinError(ERROR_CODES.SkinUploadFailed, verdict.reason);
    }
    const session = requireSession();
    if (session.provider === 'yggdrasil') return uploadSkinYggdrasil(session, payload);
    return uploadSkinMojang(session, payload);
  };

  const clearSkin = async (): Promise<void> => {
    const session = requireSession();
    if (session.provider === 'yggdrasil') {
      const client = getYggdrasilClient();
      // Snapshot the URLs before deleting so we can invalidate the cache.
      const before = await client.getTextures(session.profile.uuid).catch(() => null);
      try {
        await Promise.all([
          client.deleteSkin({ accessToken: session.accessToken }),
          client.deleteCape({ accessToken: session.accessToken }),
        ]);
      } catch (error) {
        logger.warn('Failed to clear textures on Yggdrasil server', error);
      }
      if (before?.skin?.url) await invalidateMediaCache(before.skin.url);
      if (before?.cape?.url) await invalidateMediaCache(before.cape.url);
      return;
    }

    // Mojang: drop the active skin via the kit. Capes are not exposed by the
    // kit (Mojang does not allow launchers to manage them), so nothing to do
    // for the cape slot.
    try {
      const profile = await kit.auth.profile.resetSkin({ accessToken: session.accessToken });
      setStoredAuth(withRefreshedProfile(session, profile));
    } catch (error) {
      logger.warn('Failed to reset Mojang skin', error);
    }
  };

  return { uploadSkin, clearSkin };
};

import { FetchHttpClient, fetchMinecraftProfile } from '@loontail/minecraft-kit';
import { buildMediaUrl } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { getStoredAuth, setStoredAuth } from '@main/infra/store';
import { invalidateMediaCache, prewarmMediaCache } from '@main/services/media/mediaCache';
import { ERROR_CODES } from '@shared/constants';
import type { AuthSession, MojangSession, StrapiSession } from '@shared/contracts/auth';
import { type UserId, asUserId } from '@shared/contracts/ids';
import {
  type SkinKind,
  SkinKinds,
  type UploadSkinPayload,
  type UploadSkinResult,
} from '@shared/contracts/skin';
import { hideMojangCape, resetMojangSkin, uploadMojangSkin } from './mojangSkinApi';
import { updateUserSkinFields, uploadSkinFile } from './skinApi';

const logger = scopedLogger('skin');

// Re-used for the post-upload `/minecraft/profile` refresh; cheaper than
// spinning up a fresh kit instance for one request.
const http = new FetchHttpClient();

const requireSession = (): AuthSession => {
  const session = getStoredAuth();
  if (!session) {
    throw {
      code: ERROR_CODES.SkinNotAuthenticated,
      message: 'No authenticated user',
    };
  }
  return session;
};

const throwUploadError = (prefix: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  throw {
    code: ERROR_CODES.SkinUploadFailed,
    message: `${prefix}: ${message}`,
  };
};

// Drop the cached binary so cache:// falls back to the network when the URL
// changes (Strapi-flavoured asset URL contains a hash that flips on upload).
const updateStoredStrapiUserAsset = (
  session: StrapiSession,
  kind: SkinKind,
  url: string | null,
): void => {
  const previous = session.user[kind];
  if (typeof previous === 'string' && previous.length > 0) {
    invalidateMediaCache(previous);
  }
  setStoredAuth({
    provider: 'strapi',
    jwt: session.jwt,
    user: { ...session.user, [kind]: url },
  });
};

// Hit /minecraft/profile after a mutation so the renderer's account section
// reflects the new active skin/cape URL on the next read.
const refreshStoredMojangProfile = async (session: MojangSession): Promise<MojangSession> => {
  try {
    const profile = await fetchMinecraftProfile({ http, accessToken: session.accessToken });
    const next: MojangSession = {
      ...session,
      profile: {
        uuid: profile.uuid,
        username: profile.username,
        skins: [...profile.skins],
        capes: [...profile.capes],
      },
    };
    setStoredAuth(next);
    return next;
  } catch (error) {
    logger.warn('Failed to refresh Mojang profile after skin mutation', error);
    return session;
  }
};

const activeMojangSkinUrl = (session: MojangSession): string | null =>
  session.profile.skins.find((s) => s.state === 'ACTIVE')?.url ?? null;

const activeMojangCapeUrl = (session: MojangSession): string | null =>
  session.profile.capes.find((c) => c.state === 'ACTIVE')?.url ?? null;

// Strapi flow: upload to skins-registry, then PUT the user record so
// /users/me reflects the new asset URL.
const uploadSkinStrapi = async (
  session: StrapiSession,
  payload: UploadSkinPayload,
): Promise<UploadSkinResult> => {
  const userId: UserId = asUserId(session.user.id);
  const username = session.user.username;
  const buffer = Buffer.from(payload.buffer);

  const uploadedUrl = await uploadSkinFile(userId, payload.type, buffer, username)
    .then((uploaded) => buildMediaUrl(uploaded.fileUrl))
    .catch((error: unknown) => {
      logger.error('Skin upload (file) failed', { kind: payload.type, error });
      return throwUploadError('Upload to skins-registry failed', error);
    });

  try {
    await updateUserSkinFields(userId, { [payload.type]: uploadedUrl });
  } catch (error) {
    logger.error('Skin upload (update user) failed', { kind: payload.type, error });
    throwUploadError('Update user skin field failed', error);
  }

  updateStoredStrapiUserAsset(session, payload.type, uploadedUrl);
  prewarmMediaCache(uploadedUrl, buffer);
  return { url: uploadedUrl };
};

// Mojang flow: POST PNG to api.minecraftservices.com/minecraft/profile/skins.
// Mojang does not accept arbitrary cape uploads (capes are issued by Mojang
// for events/promotions); only skins can be written.
const uploadSkinMojang = async (
  session: MojangSession,
  payload: UploadSkinPayload,
): Promise<UploadSkinResult> => {
  if (payload.type === SkinKinds.CAPE) {
    throw {
      code: ERROR_CODES.SkinUploadFailed,
      message:
        'Mojang accounts cannot upload custom capes; only Mojang-issued capes can be activated',
    };
  }
  const buffer = Buffer.from(payload.buffer);
  try {
    // Default to CLASSIC variant. A future UI surface could expose a
    // CLASSIC/SLIM toggle; for now this matches the most common case.
    await uploadMojangSkin(session.accessToken, 'CLASSIC', buffer);
  } catch (error) {
    logger.error('Mojang skin upload failed', error);
    throwUploadError('Mojang skin upload failed', error);
  }

  const refreshed = await refreshStoredMojangProfile(session);
  const url = activeMojangSkinUrl(refreshed);
  if (url === null) {
    throw {
      code: ERROR_CODES.SkinUploadFailed,
      message: 'Mojang accepted the upload but did not return an active skin URL',
    };
  }
  prewarmMediaCache(url, buffer);
  return { url };
};

export const uploadSkin = async (payload: UploadSkinPayload): Promise<UploadSkinResult> => {
  const session = requireSession();
  if (session.provider === 'strapi') return uploadSkinStrapi(session, payload);
  return uploadSkinMojang(session, payload);
};

export const clearSkin = async (): Promise<void> => {
  const session = requireSession();
  if (session.provider === 'strapi') {
    const userId = asUserId(session.user.id);
    try {
      await updateUserSkinFields(userId, { skin: null, cape: null });
    } catch (error) {
      logger.warn('Failed to clear Strapi skin fields on server', error);
    }
    updateStoredStrapiUserAsset(session, SkinKinds.SKIN, null);
    const after = getStoredAuth();
    if (after?.provider === 'strapi') updateStoredStrapiUserAsset(after, SkinKinds.CAPE, null);
    return;
  }

  // Mojang: reset the active skin and hide the active cape. Failures are
  // logged but non-fatal — the UI still drops local state to match user
  // intent, and the next /minecraft/profile refresh will resync.
  try {
    await resetMojangSkin(session.accessToken);
  } catch (error) {
    logger.warn('Failed to reset Mojang skin', error);
  }
  if (activeMojangCapeUrl(session) !== null) {
    try {
      await hideMojangCape(session.accessToken);
    } catch (error) {
      logger.warn('Failed to hide Mojang cape', error);
    }
  }
  await refreshStoredMojangProfile(session);
};

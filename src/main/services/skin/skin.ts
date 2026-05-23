import type { MinecraftProfile, MojangSkinVariant } from '@loontail/minecraft-kit';
import { buildMediaUrl } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { getStoredAuth, setStoredAuth } from '@main/infra/store';
import { withRefreshedProfile } from '@main/services/auth/mojangAuth';
import { kit } from '@main/services/kit';
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
import { updateUserSkinFields, uploadSkinFile } from './skinApi';

const logger = scopedLogger('skin');

const DEFAULT_MOJANG_SKIN_VARIANT: MojangSkinVariant = 'CLASSIC';

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

const activeMojangSkinUrl = (session: MojangSession): string | null =>
  session.profile.skins.find((s) => s.state === 'ACTIVE')?.url ?? null;

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

// Mojang flow: hand the PNG to `kit.auth.profile.uploadSkin`, which posts
// it to api.minecraftservices.com/minecraft/profile/skins. The renderer
// gates cape uploads off for Mojang accounts; a CAPE payload reaching here
// means something bypassed the UI, so we treat it as an invariant break.
const uploadSkinMojang = async (
  session: MojangSession,
  payload: UploadSkinPayload,
): Promise<UploadSkinResult> => {
  if (payload.type !== SkinKinds.SKIN) {
    throw {
      code: ERROR_CODES.SkinUploadFailed,
      message: 'Mojang accounts cannot upload custom capes',
    };
  }
  const skin = new Uint8Array(payload.buffer);
  let profile: MinecraftProfile;
  try {
    profile = await kit.auth.profile.uploadSkin({
      accessToken: session.accessToken,
      skin,
      variant: payload.variant ?? DEFAULT_MOJANG_SKIN_VARIANT,
    });
  } catch (error) {
    logger.error('Mojang skin upload failed', error);
    return throwUploadError('Mojang skin upload failed', error);
  }

  const refreshed = withRefreshedProfile(session, profile);
  setStoredAuth(refreshed);
  const url = activeMojangSkinUrl(refreshed);
  if (url === null) {
    throw {
      code: ERROR_CODES.SkinUploadFailed,
      message: 'Mojang accepted the upload but did not return an active skin URL',
    };
  }
  prewarmMediaCache(url, Buffer.from(skin));
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

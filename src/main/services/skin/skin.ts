import { buildMediaUrl } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { getStoredAuth, setStoredAuth } from '@main/infra/store';
import { invalidateMediaCache, prewarmMediaCache } from '@main/services/media/mediaCache';
import { ERROR_CODES } from '@shared/constants';
import { type UserId, asUserId } from '@shared/contracts/ids';
import {
  type SkinKind,
  SkinKinds,
  type UploadSkinPayload,
  type UploadSkinResult,
} from '@shared/contracts/skin';
import { updateUserSkinFields, uploadSkinFile } from './skinApi';

const logger = scopedLogger('skin');

const requireUserId = (): UserId => {
  const auth = getStoredAuth();
  if (!auth) {
    throw {
      code: ERROR_CODES.SkinNotAuthenticated,
      message: 'No authenticated user',
    };
  }
  return asUserId(auth.user.id);
};

const updateStoredUserAsset = (kind: SkinKind, url: string | null) => {
  // Drop the cached binary so cache:// falls back to the network if the URL changes.
  const previous = getStoredAuth()?.user?.[kind];
  if (typeof previous === 'string' && previous.length > 0) {
    invalidateMediaCache(previous);
  }
  const auth = getStoredAuth();
  if (!auth) return;
  const nextUser = { ...auth.user, [kind]: url };
  setStoredAuth({ jwt: auth.jwt, user: nextUser });
};

export const uploadSkin = async (payload: UploadSkinPayload): Promise<UploadSkinResult> => {
  const userId = requireUserId();
  const username = getStoredAuth()?.user.username;
  const buffer = Buffer.from(payload.buffer);

  let uploadedUrl: string;
  try {
    const uploaded = await uploadSkinFile(userId, payload.type, buffer, username);
    uploadedUrl = buildMediaUrl(uploaded.fileUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Skin upload (file) failed', { kind: payload.type, error });
    throw {
      code: ERROR_CODES.SkinUploadFailed,
      message: `Upload to skins-registry failed: ${message}`,
    };
  }

  try {
    await updateUserSkinFields(userId, { [payload.type]: uploadedUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Skin upload (update user) failed', { kind: payload.type, error });
    throw {
      code: ERROR_CODES.SkinUploadFailed,
      message: `Update user skin field failed: ${message}`,
    };
  }

  updateStoredUserAsset(payload.type, uploadedUrl);
  prewarmMediaCache(uploadedUrl, buffer);
  return { url: uploadedUrl };
};

export const clearSkin = async (): Promise<void> => {
  const userId = requireUserId();
  try {
    await updateUserSkinFields(userId, { skin: null, cape: null });
  } catch (error) {
    logger.warn('Failed to clear skin fields on server', error);
  }
  updateStoredUserAsset(SkinKinds.SKIN, null);
  updateStoredUserAsset(SkinKinds.CAPE, null);
};

import { writeBuffer } from '@main/infra/cache';
import { scopedLogger } from '@main/infra/logger';
import { getStoredAuth, setStoredAuth } from '@main/infra/store';
import { ERROR_CODES } from '@shared/constants';
import type { SkinKind, UploadSkinPayload, UploadSkinResult } from '@shared/contracts/skin';
import { buildMediaUrl, updateUserSkinFields, uploadSkinFile } from './skinApi';

const CACHE_NAMESPACE = 'skins';

const logger = scopedLogger('skin');

const requireUserId = (): number => {
  const auth = getStoredAuth();
  if (!auth) {
    throw {
      code: ERROR_CODES.SkinNotAuthenticated,
      message: 'No authenticated user',
    };
  }
  return auth.user.id;
};

const cacheKey = (userId: number, kind: SkinKind): string => `${userId}-${kind}`;

const updateStoredUserAsset = (kind: SkinKind, url: string | null): void => {
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

  writeBuffer(CACHE_NAMESPACE, cacheKey(userId, payload.type), buffer);
  updateStoredUserAsset(payload.type, uploadedUrl);
  return { url: uploadedUrl };
};

export const clearSkin = async (): Promise<void> => {
  const userId = requireUserId();
  try {
    await updateUserSkinFields(userId, { skin: null, cape: null });
  } catch (error) {
    logger.warn('Failed to clear skin fields on server', error);
  }
  updateStoredUserAsset('skin', null);
  updateStoredUserAsset('cape', null);
};

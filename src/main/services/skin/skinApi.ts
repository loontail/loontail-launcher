import {
  buildMediaUrl,
  httpGet,
  httpGetBinary,
  httpPostMultipart,
  httpPutVoid,
} from '@main/infra/http';
import { API_ROUTES } from '@shared/constants';
import type { UserId } from '@shared/contracts/ids';
import type { SkinKind } from '@shared/contracts/skin';
import { z } from 'zod';

export type SkinFields = { skin: string | null; cape: string | null };
export type UploadedAsset = { id: number; userId: number; fileUrl: string };

const SkinFieldsResponseSchema = z
  .object({
    skin: z.union([z.string(), z.null()]).optional(),
    cape: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

const UploadedAssetSchema = z.object({
  id: z.number(),
  userId: z.number(),
  fileUrl: z.string(),
});

export const getUserSkinFields = async (userId: UserId): Promise<SkinFields> => {
  const parsed = await httpGet(API_ROUTES.users.byId(userId), SkinFieldsResponseSchema, {
    auth: 'session',
  });
  return { skin: parsed.skin ?? null, cape: parsed.cape ?? null };
};

export const updateUserSkinFields = (userId: UserId, fields: Partial<SkinFields>): Promise<void> =>
  httpPutVoid(API_ROUTES.users.byId(userId), fields, { auth: 'session' });

export const uploadSkinFile = (
  userId: UserId,
  type: SkinKind,
  buffer: Buffer,
  username?: string,
): Promise<UploadedAsset> => {
  const formData = new FormData();
  const blob = new Blob([buffer as unknown as ArrayBuffer], { type: 'image/png' });
  formData.append('file', blob, `${type}_${userId}.png`);
  if (username) formData.append('username', username);
  return httpPostMultipart(
    API_ROUTES.skinsRegistry.upload(type, userId),
    UploadedAssetSchema,
    formData,
    { auth: 'session' },
  );
};

export const fetchAssetBytes = (fileUrl: string): Promise<Buffer> =>
  httpGetBinary(buildMediaUrl(fileUrl));

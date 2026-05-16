import { mainConfig } from '@main/config';
import { HttpError, buildAuthHeader, buildMediaUrl, httpGet, httpPutVoid } from '@main/infra/http';
import { API_PATH_PREFIX, API_ROUTES } from '@shared/constants';
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

const BODY_PREVIEW_LIMIT = 500;

const readErrorBody = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    return text.slice(0, BODY_PREVIEW_LIMIT);
  } catch {
    return '';
  }
};

export const getUserSkinFields = async (userId: UserId): Promise<SkinFields> => {
  const parsed = await httpGet(API_ROUTES.users.byId(userId), SkinFieldsResponseSchema);
  return { skin: parsed.skin ?? null, cape: parsed.cape ?? null };
};

export const updateUserSkinFields = (userId: UserId, fields: Partial<SkinFields>): Promise<void> =>
  httpPutVoid(API_ROUTES.users.byId(userId), fields);

export const uploadSkinFile = async (
  userId: UserId,
  type: SkinKind,
  buffer: Buffer,
  username?: string,
): Promise<UploadedAsset> => {
  const formData = new FormData();
  const blob = new Blob([buffer as unknown as ArrayBuffer], { type: 'image/png' });
  formData.append('file', blob, `${type}_${userId}.png`);
  if (username) formData.append('username', username);

  const endpoint = `${mainConfig.apiUrl}${API_PATH_PREFIX}${API_ROUTES.skinsRegistry.upload(type, userId)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
    headers: buildAuthHeader(mainConfig.apiToken),
  });
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, await readErrorBody(response));
  }
  const raw: unknown = await response.json();
  return UploadedAssetSchema.parse(raw);
};

export const fetchAssetBytes = async (fileUrl: string): Promise<Buffer> => {
  const absolute = buildMediaUrl(fileUrl);
  const response = await fetch(absolute);
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, await readErrorBody(response));
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

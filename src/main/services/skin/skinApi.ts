import { mainConfig } from '@main/config';
import { buildMediaUrl, httpRequest } from '@main/infra/http';
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

const readErrorBody = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
};

export { buildMediaUrl };

export const getUserSkinFields = async (userId: UserId): Promise<SkinFields> => {
  const response = await httpRequest(API_ROUTES.users.byId(userId));
  if (!response.ok) {
    throw new Error(`getUserSkinFields HTTP ${response.status}: ${await readErrorBody(response)}`);
  }
  const raw: unknown = await response.json();
  const parsed = SkinFieldsResponseSchema.parse(raw);
  return { skin: parsed.skin ?? null, cape: parsed.cape ?? null };
};

export const updateUserSkinFields = async (
  userId: UserId,
  fields: Partial<SkinFields>,
): Promise<void> => {
  const response = await httpRequest(API_ROUTES.users.byId(userId), {
    method: 'PUT',
    payload: fields,
  });
  if (!response.ok) {
    throw new Error(
      `updateUserSkinFields HTTP ${response.status}: ${await readErrorBody(response)}`,
    );
  }
};

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
    headers: { Authorization: `Bearer ${mainConfig.apiToken}` },
  });
  if (!response.ok) {
    throw new Error(`uploadSkinFile HTTP ${response.status}: ${await readErrorBody(response)}`);
  }
  const raw: unknown = await response.json();
  return UploadedAssetSchema.parse(raw);
};

export const fetchAssetBytes = async (fileUrl: string): Promise<Buffer> => {
  const absolute = buildMediaUrl(fileUrl);
  const response = await fetch(absolute);
  if (!response.ok) {
    throw new Error(`fetchAssetBytes HTTP ${response.status}: ${await readErrorBody(response)}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

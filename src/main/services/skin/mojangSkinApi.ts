import { scopedLogger } from '@main/infra/logger';
import type { SkinVariant } from '@shared/contracts/auth';

const logger = scopedLogger('skin.mojang');

// Thrown when Mojang rejects the access token mid-skin-operation. Verify
// helpers downstream may want to clear the stored session.
export class MojangUnauthorizedError extends Error {
  constructor() {
    super('Mojang access token rejected (401)');
    this.name = 'MojangUnauthorizedError';
  }
}

const MOJANG_API = 'https://api.minecraftservices.com';

const SKINS_ACTIVE = `${MOJANG_API}/minecraft/profile/skins`;
const SKIN_ACTIVE_RESET = `${MOJANG_API}/minecraft/profile/skins/active`;
const CAPE_ACTIVE = `${MOJANG_API}/minecraft/profile/capes/active`;

const authHeader = (accessToken: string): Record<string, string> => ({
  authorization: `Bearer ${accessToken}`,
});

const throwForStatus = async (response: Response, action: string): Promise<void> => {
  if (response.ok) return;
  if (response.status === 401) throw new MojangUnauthorizedError();
  const body = await response.text().catch(() => '');
  logger.warn(`${action} failed: HTTP ${response.status} ${body.slice(0, 200)}`);
  throw new Error(`Mojang ${action} failed: HTTP ${response.status}`);
};

// POST a PNG to /minecraft/profile/skins as multipart form data. Mojang
// requires the `variant` field (CLASSIC or SLIM) and the file as `file`.
export const uploadMojangSkin = async (
  accessToken: string,
  variant: SkinVariant,
  buffer: Buffer,
): Promise<void> => {
  const form = new FormData();
  form.append('variant', variant);
  const blob = new Blob([buffer as unknown as ArrayBuffer], { type: 'image/png' });
  form.append('file', blob, 'skin.png');
  const response = await fetch(SKINS_ACTIVE, {
    method: 'POST',
    headers: authHeader(accessToken),
    body: form,
  });
  await throwForStatus(response, 'skin upload');
};

// Switch back to the default vanilla skin. Note: Mojang has no separate
// "delete uploaded skin" — the active row just gets reset to the default
// model server-side.
export const resetMojangSkin = async (accessToken: string): Promise<void> => {
  const response = await fetch(SKIN_ACTIVE_RESET, {
    method: 'DELETE',
    headers: authHeader(accessToken),
  });
  await throwForStatus(response, 'skin reset');
};

// Mojang accounts can't upload custom capes; they can only switch between
// capes Mojang has issued (Migrator, MineCon, etc.). `setActive` accepts a
// cape id from the user's profile.capes[].
export const setActiveMojangCape = async (accessToken: string, capeId: string): Promise<void> => {
  const response = await fetch(CAPE_ACTIVE, {
    method: 'PUT',
    headers: {
      ...authHeader(accessToken),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ capeId }),
  });
  await throwForStatus(response, 'cape activate');
};

export const hideMojangCape = async (accessToken: string): Promise<void> => {
  const response = await fetch(CAPE_ACTIVE, {
    method: 'DELETE',
    headers: authHeader(accessToken),
  });
  await throwForStatus(response, 'cape hide');
};

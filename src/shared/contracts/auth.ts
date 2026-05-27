import type {
  AzureClientId,
  MicrosoftRefreshToken,
  MojangProfileSkin,
  PlayerUuid,
} from '@loontail/minecraft-kit';
import { isUuidUndashed } from '@loontail/yggdrasil-core';
import { z } from 'zod';
import type { Account } from './account';

export const AUTH_PROVIDERS = ['yggdrasil', 'mojang'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

// Re-export kit-side literal unions so renderer/IPC code uses a single source of truth.
export type { MojangAssetState, MojangSkinVariant as SkinVariant } from '@loontail/minecraft-kit';

// Mirror of kit's `MojangProfileSkin` shape; kept here so the persisted-store
// Zod schema can validate it without pulling kit's runtime into shared/.
const MojangProfileSkinSchema: z.ZodType<MojangProfileSkin> = z.object({
  id: z.string(),
  state: z.enum(['ACTIVE', 'INACTIVE']),
  url: z.string(),
  variant: z.enum(['CLASSIC', 'SLIM']),
  textureKey: z.string().optional(),
});

// The kit's `as*` brand validators are runtime imports that drag yauzl/stream
// into the renderer bundle. Shared code can only carry types; the kit will
// reject malformed values at the point of use.
const PlayerUuidSchema = z.string().transform((value): PlayerUuid => value as PlayerUuid);
const AzureClientIdSchema = z.string().transform((value): AzureClientId => value as AzureClientId);
const MicrosoftRefreshTokenSchema = z
  .string()
  .transform((value): MicrosoftRefreshToken => value as MicrosoftRefreshToken);

export const MojangProfileSchema = z.object({
  uuid: PlayerUuidSchema,
  username: z.string(),
  skins: z.array(MojangProfileSkinSchema),
});

export type MojangProfile = z.infer<typeof MojangProfileSchema>;

// `selectedProfile.id` from the Yggdrasil server is the 32-char undashed hex
// UUID (per the Mojang/Yggdrasil spec). The launcher dashes it before handing
// it to the kit's launch composer.
export const YggdrasilProfileSchema = z.object({
  uuid: z.string().refine(isUuidUndashed, 'profile id must be 32-char undashed hex'),
  name: z.string().min(1),
});
export type YggdrasilProfile = z.infer<typeof YggdrasilProfileSchema>;

// Stored session shapes — discriminated by `provider`.
//
// `YggdrasilSession` carries only what the Yggdrasil protocol provides:
// the access/client token pair and the selected profile. Anything that lives
// outside the protocol (Strapi numeric user id, email, current skin/cape URLs)
// is fetched separately via the launcher's static API_TOKEN, not via the
// Yggdrasil session.
export const YggdrasilSessionSchema = z.object({
  provider: z.literal('yggdrasil'),
  accessToken: z.string().min(1),
  clientToken: z.string().min(1),
  profile: YggdrasilProfileSchema,
});

export type YggdrasilSession = z.infer<typeof YggdrasilSessionSchema>;

export const MojangSessionSchema = z.object({
  provider: z.literal('mojang'),
  accessToken: z.string(),
  expiresAt: z.number(),
  refreshToken: MicrosoftRefreshTokenSchema,
  clientId: AzureClientIdSchema,
  xuid: z.string(),
  profile: MojangProfileSchema,
});

export type MojangSession = z.infer<typeof MojangSessionSchema>;

export const AuthSessionSchema = z.discriminatedUnion('provider', [
  YggdrasilSessionSchema,
  MojangSessionSchema,
]);

export type AuthSession = z.infer<typeof AuthSessionSchema>;

// Login (Yggdrasil authserver). Mojang has its own IPC flow.
export const LoginPayloadSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;

export const LOGIN_ERROR_CODE = {
  NetworkError: 'NETWORK_ERROR',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  RateLimited: 'RATE_LIMITED',
  Unknown: 'UNKNOWN',
} as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODE)[keyof typeof LOGIN_ERROR_CODE];

export type LoginResult = { ok: true; user: Account } | { ok: false; error: LoginErrorCode };

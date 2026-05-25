import {
  type AzureClientId,
  type MicrosoftRefreshToken,
  type MojangProfileSkin,
  type PlayerUuid,
  asAzureClientId,
  asMicrosoftRefreshToken,
  asPlayerUuid,
} from '@loontail/minecraft-kit';
import { z } from 'zod';
import type { Account } from './account';

export const AUTH_PROVIDERS = ['strapi', 'mojang'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

// Strapi-side user as returned by /api/auth/local and /api/users/me.
export const StrapiUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string().email(),
  blocked: z.boolean(),
  skin: z.string().nullable().optional(),
  cape: z.string().nullable().optional(),
});
export type StrapiUser = z.infer<typeof StrapiUserSchema>;

export const StrapiAuthOkSchema = z.object({
  jwt: z.string().min(1),
  user: StrapiUserSchema,
});
export type StrapiAuthOk = z.infer<typeof StrapiAuthOkSchema>;

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

const PlayerUuidSchema = z.string().transform((value): PlayerUuid => asPlayerUuid(value));
const AzureClientIdSchema = z.string().transform((value): AzureClientId => asAzureClientId(value));
const MicrosoftRefreshTokenSchema = z
  .string()
  .transform((value): MicrosoftRefreshToken => asMicrosoftRefreshToken(value));

export const MojangProfileSchema = z.object({
  uuid: PlayerUuidSchema,
  username: z.string(),
  skins: z.array(MojangProfileSkinSchema),
});

export type MojangProfile = z.infer<typeof MojangProfileSchema>;

// Stored session shapes — discriminated by `provider`.
export const StrapiSessionSchema = z.object({
  provider: z.literal('strapi'),
  jwt: z.string().min(1),
  user: StrapiUserSchema,
});

export type StrapiSession = z.infer<typeof StrapiSessionSchema>;

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
  StrapiSessionSchema,
  MojangSessionSchema,
]);

export type AuthSession = z.infer<typeof AuthSessionSchema>;

// Login (Strapi local provider). Mojang has its own IPC flow added later.
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

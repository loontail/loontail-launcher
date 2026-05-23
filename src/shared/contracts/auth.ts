import type {
  AzureClientId,
  MicrosoftRefreshToken,
  MojangProfileSkin,
  PlayerUuid,
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

export type MojangProfile = {
  uuid: PlayerUuid;
  username: string;
  skins: MojangProfileSkin[];
};

// Stored session shapes — discriminated by `provider`.
export type StrapiSession = {
  provider: 'strapi';
  jwt: string;
  user: StrapiUser;
};

export type MojangSession = {
  provider: 'mojang';
  accessToken: string;
  expiresAt: number;
  refreshToken: MicrosoftRefreshToken;
  clientId: AzureClientId;
  xuid: string;
  profile: MojangProfile;
};

export type AuthSession = StrapiSession | MojangSession;

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

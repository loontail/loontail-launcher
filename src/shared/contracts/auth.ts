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

// Subset of GET https://api.minecraftservices.com/minecraft/profile that the
// launcher consumes. The Mojang response carries more fields; capture what's
// needed and let the rest pass through unparsed.
export const SKIN_VARIANTS = ['CLASSIC', 'SLIM'] as const;
export type SkinVariant = (typeof SKIN_VARIANTS)[number];

export const MOJANG_ASSET_STATES = ['ACTIVE', 'INACTIVE'] as const;
export type MojangAssetState = (typeof MOJANG_ASSET_STATES)[number];

export const MojangSkinSchema = z.object({
  id: z.string(),
  url: z.string(),
  state: z.enum(MOJANG_ASSET_STATES),
  variant: z.enum(SKIN_VARIANTS),
});
export type MojangSkin = z.infer<typeof MojangSkinSchema>;

export const MojangCapeSchema = z.object({
  id: z.string(),
  url: z.string(),
  state: z.enum(MOJANG_ASSET_STATES),
  alias: z.string().optional(),
});
export type MojangCape = z.infer<typeof MojangCapeSchema>;

export const MojangProfileSchema = z.object({
  uuid: z.string(),
  username: z.string(),
  skins: z.array(MojangSkinSchema),
  capes: z.array(MojangCapeSchema),
});
export type MojangProfile = z.infer<typeof MojangProfileSchema>;

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
  refreshToken: string;
  clientId: string;
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

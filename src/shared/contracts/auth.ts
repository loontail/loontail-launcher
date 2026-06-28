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

// Re-export kit-side literal unions so renderer/IPC code uses one source of truth.
export type { MojangAssetState, SkinVariant } from '@loontail/minecraft-kit';

const NonEmptyStringSchema = z.string().min(1);
const MOJANG_MILLISECOND_TIMESTAMP_MIN = Date.UTC(2000, 0, 1);
const MOJANG_XUID_PATTERN = /^\d+$/;

// Mirror of kit's `MojangProfileSkin`, kept here so the persisted-store schema
// can validate it without pulling kit's runtime into shared/.
const MojangProfileSkinSchema = z.object({
  id: NonEmptyStringSchema,
  state: z.enum(['ACTIVE', 'INACTIVE']),
  url: NonEmptyStringSchema,
  variant: z.enum(['CLASSIC', 'SLIM']),
  textureKey: NonEmptyStringSchema.optional(),
});

// Compile-time guard: the two-way `extends` check fails tsc if the mirror drifts
// from kit's `MojangProfileSkin`, forcing a schema update rather than silently
// stripping a new field when a persisted session is rehydrated.
type MojangProfileSkinShapeMatches = z.infer<
  typeof MojangProfileSkinSchema
> extends MojangProfileSkin
  ? MojangProfileSkin extends z.infer<typeof MojangProfileSkinSchema>
    ? true
    : ['kit field missing from MojangProfileSkinSchema']
  : ['schema field missing from kit MojangProfileSkin'];
const _mojangProfileSkinShapeCheck: MojangProfileSkinShapeMatches = true;
void _mojangProfileSkinShapeCheck;

// Kit's `as*` brand validators are runtime imports that drag yauzl/stream into
// the renderer bundle, so shared code re-validates with Zod before branding.
export const PlayerUuidSchema = z
  .string()
  .uuid()
  .transform((value): PlayerUuid => value as PlayerUuid);
export const AzureClientIdSchema = z
  .string()
  .uuid()
  .transform((value): AzureClientId => value as AzureClientId);
export const MicrosoftRefreshTokenSchema = NonEmptyStringSchema.transform(
  (value): MicrosoftRefreshToken => value as MicrosoftRefreshToken,
);
export const MojangXuidSchema = z.string().regex(MOJANG_XUID_PATTERN);
export const MojangExpiresAtSchema = z
  .number()
  .finite()
  .int()
  .gte(MOJANG_MILLISECOND_TIMESTAMP_MIN);

export const MojangProfileSchema = z.object({
  uuid: PlayerUuidSchema,
  username: NonEmptyStringSchema,
  skins: z.array(MojangProfileSkinSchema),
});

// Yggdrasil `selectedProfile.id` is the 32-char undashed hex UUID per spec; the
// launcher dashes it before the kit's launch composer.
export const YggdrasilProfileSchema = z.object({
  uuid: z.string().refine(isUuidUndashed, 'profile id must be 32-char undashed hex'),
  name: NonEmptyStringSchema,
});

// Stored session shapes, discriminated by `provider`. The Yggdrasil
// `accessToken`/`clientToken` pair is the in-game online-mode handshake material
// (fed only to the game), distinct from the universal API bearer (the separate
// Loontail session token persisted alongside it).
export const YggdrasilSessionSchema = z.object({
  provider: z.literal('yggdrasil'),
  accessToken: NonEmptyStringSchema,
  clientToken: NonEmptyStringSchema,
  profile: YggdrasilProfileSchema,
});

export type YggdrasilSession = z.infer<typeof YggdrasilSessionSchema>;

export const MojangSessionSchema = z.object({
  provider: z.literal('mojang'),
  accessToken: NonEmptyStringSchema,
  expiresAt: MojangExpiresAtSchema,
  refreshToken: MicrosoftRefreshTokenSchema,
  clientId: AzureClientIdSchema,
  xuid: MojangXuidSchema,
  profile: MojangProfileSchema,
});

export type MojangSession = z.infer<typeof MojangSessionSchema>;

export const AuthSessionSchema = z.discriminatedUnion('provider', [
  YggdrasilSessionSchema,
  MojangSessionSchema,
]);

export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const LoginPayloadSchema = z.object({
  identifier: NonEmptyStringSchema,
  password: NonEmptyStringSchema,
});
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;

export const RegisterPayloadSchema = z.object({
  username: NonEmptyStringSchema,
  email: z.string().email(),
  password: NonEmptyStringSchema,
});
export type RegisterPayload = z.infer<typeof RegisterPayloadSchema>;

// Shape returned by POST /api/auth/{login,register,refresh}. `session.token` is
// the universal API bearer; the `minecraft` pair is the in-game Yggdrasil
// handshake material; `profile` is the renderer-facing identity.
export const LoontailAuthResponseSchema = z.object({
  session: z.object({
    token: NonEmptyStringSchema,
    expiresAt: z.union([z.string(), z.number()]).nullable().optional(),
  }),
  minecraft: z.object({
    accessToken: NonEmptyStringSchema,
    clientToken: NonEmptyStringSchema,
  }),
  profile: z.object({
    id: z.union([z.string(), z.number()]),
    username: NonEmptyStringSchema,
    email: z.string().nullable().optional(),
    uuid: z.string().refine(isUuidUndashed, 'profile uuid must be 32-char undashed hex'),
    isAdmin: z.boolean().optional(),
  }),
});
export type LoontailAuthResponse = z.infer<typeof LoontailAuthResponseSchema>;

export const LOGIN_ERROR_CODE = {
  NetworkError: 'NETWORK_ERROR',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  RateLimited: 'RATE_LIMITED',
  BrowserOpenFailed: 'BROWSER_OPEN_FAILED',
  // The user aborted the browser sign-in flow. The renderer suppresses this
  // instead of rendering a failure banner.
  Cancelled: 'CANCELLED',
  Unknown: 'UNKNOWN',
} as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODE)[keyof typeof LOGIN_ERROR_CODE];

export type LoginResult = { ok: true; user: Account } | { ok: false; error: LoginErrorCode };

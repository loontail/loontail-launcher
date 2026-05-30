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
export type { MojangAssetState, SkinVariant } from '@loontail/minecraft-kit';

const NonEmptyStringSchema = z.string().min(1);
const MOJANG_MILLISECOND_TIMESTAMP_MIN = Date.UTC(2000, 0, 1);
const MOJANG_XUID_PATTERN = /^\d+$/;

// Mirror of kit's `MojangProfileSkin` shape; kept here so the persisted-store
// Zod schema can validate it without pulling kit's runtime into shared/.
const MojangProfileSkinSchema = z.object({
  id: NonEmptyStringSchema,
  state: z.enum(['ACTIVE', 'INACTIVE']),
  url: NonEmptyStringSchema,
  variant: z.enum(['CLASSIC', 'SLIM']),
  textureKey: NonEmptyStringSchema.optional(),
});

// Compile-time guard: the mirror above must stay structurally identical to the
// kit's `MojangProfileSkin`. The bare `z.object` (no `z.ZodType` cast) keeps
// Zod's exhaustiveness, and the two-way `extends` check fails tsc if the kit
// adds, renames, or retypes a field — forcing a schema update instead of
// silently stripping the new field when a persisted session is rehydrated.
type MojangProfileSkinShapeMatches = z.infer<
  typeof MojangProfileSkinSchema
> extends MojangProfileSkin
  ? MojangProfileSkin extends z.infer<typeof MojangProfileSkinSchema>
    ? true
    : ['kit field missing from MojangProfileSkinSchema']
  : ['schema field missing from kit MojangProfileSkin'];
const _mojangProfileSkinShapeCheck: MojangProfileSkinShapeMatches = true;
void _mojangProfileSkinShapeCheck;

// The kit's `as*` brand validators are runtime imports that drag yauzl/stream
// into the renderer bundle. Shared code carries the same primitive shape and
// adds lightweight Zod checks before applying the compile-time brand.
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

export type MojangProfile = z.infer<typeof MojangProfileSchema>;

// `selectedProfile.id` from the Yggdrasil server is the 32-char undashed hex
// UUID (per the Mojang/Yggdrasil spec). The launcher dashes it before handing
// it to the kit's launch composer.
export const YggdrasilProfileSchema = z.object({
  uuid: z.string().refine(isUuidUndashed, 'profile id must be 32-char undashed hex'),
  name: NonEmptyStringSchema,
});
export type YggdrasilProfile = z.infer<typeof YggdrasilProfileSchema>;

// Stored session shapes - discriminated by `provider`.
//
// `YggdrasilSession` carries only what the Yggdrasil protocol provides:
// the access/client token pair and the selected profile. Anything that lives
// outside the protocol (Strapi numeric user id, email, current skin/cape URLs)
// is fetched separately via the launcher's static API_TOKEN, not via the
// Yggdrasil session.
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

// Login (Yggdrasil authserver). Mojang has its own IPC flow.
export const LoginPayloadSchema = z.object({
  identifier: NonEmptyStringSchema,
  password: NonEmptyStringSchema,
});
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;

export const LOGIN_ERROR_CODE = {
  NetworkError: 'NETWORK_ERROR',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  RateLimited: 'RATE_LIMITED',
  BrowserOpenFailed: 'BROWSER_OPEN_FAILED',
  Unknown: 'UNKNOWN',
} as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODE)[keyof typeof LOGIN_ERROR_CODE];

export type LoginResult = { ok: true; user: Account } | { ok: false; error: LoginErrorCode };

import { z } from 'zod';
import { type Account, AccountSchema } from './account';

export const LoginPayloadSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export type LoginPayload = z.infer<typeof LoginPayloadSchema>;

export const StrapiAuthOkSchema = z.object({
  jwt: z.string().min(1),
  user: AccountSchema,
});

export type StrapiAuthOk = z.infer<typeof StrapiAuthOkSchema>;

export type LoginErrorCode = 'NETWORK_ERROR' | 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'UNKNOWN';

export type LoginResult = { ok: true; user: Account } | { ok: false; error: LoginErrorCode };

export type AuthState = { kind: 'unauthenticated' } | { kind: 'authenticated'; user: Account };

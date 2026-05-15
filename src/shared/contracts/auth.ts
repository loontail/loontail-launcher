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

export const LOGIN_ERROR_CODE = {
  NetworkError: 'NETWORK_ERROR',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  RateLimited: 'RATE_LIMITED',
  Unknown: 'UNKNOWN',
} as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODE)[keyof typeof LOGIN_ERROR_CODE];

export type LoginResult = { ok: true; user: Account } | { ok: false; error: LoginErrorCode };

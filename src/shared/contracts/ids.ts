import { z } from 'zod';

type Brand<T, B extends string> = T & { readonly __brand: B };

export type BundleSlug = Brand<string, 'BundleSlug'>;
export type ClientId = Brand<number, 'ClientId'>;
export type UserId = Brand<number, 'UserId'>;

export const asBundleSlug = (value: string): BundleSlug => value as BundleSlug;
export const asClientId = (value: number): ClientId => value as ClientId;
export const asUserId = (value: number): UserId => value as UserId;

export const BundleSlugSchema = z
  .string()
  .min(1)
  .transform((value): BundleSlug => value as BundleSlug);

export const ClientIdSchema = z
  .number()
  .int()
  .transform((value): ClientId => value as ClientId);

export const UserIdSchema = z
  .number()
  .int()
  .transform((value): UserId => value as UserId);

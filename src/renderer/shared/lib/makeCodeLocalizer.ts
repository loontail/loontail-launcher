import type { TFunction } from 'i18next';

// The fallback key takes the same `{message}` interpolation as the mapped keys,
// so a code nobody localized yet still surfaces the raw error text. Codes arrive
// off IPC, hence hasOwn rather than `in`: `in` would resolve 'toString' to
// Object.prototype's function and hand a non-string to t().
export const makeCodeLocalizer =
  <TCode extends string>(keyByCode: Readonly<Record<TCode, string>>, fallbackKey: string) =>
  (code: string, message: string, t: TFunction): string =>
    t(Object.hasOwn(keyByCode, code) ? keyByCode[code as TCode] : fallbackKey, { message });

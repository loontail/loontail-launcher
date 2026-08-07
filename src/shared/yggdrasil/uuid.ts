import { YggdrasilError, YggdrasilErrorCodes } from '@shared/yggdrasil/errors';

const UNDASHED_RE = /^[0-9a-f]{32}$/i;
const DASHED_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuidUndashed = (value: string): boolean => UNDASHED_RE.test(value);

const isUuidDashed = (value: string): boolean => DASHED_RE.test(value);

// The rejected value is echoed into the error message, and the caller may hand
// us an arbitrary server response — cap it so a huge payload cannot bloat logs.
const truncated = (value: string): string => (value.length > 48 ? `${value.slice(0, 48)}…` : value);

const rejectUuid = (value: string): never => {
  throw new YggdrasilError(
    YggdrasilErrorCodes.INVALID_UUID,
    `Value is not a valid UUID: ${truncated(value)}`,
    { context: { value } },
  );
};

// Yggdrasil speaks the 32-char undashed form; Mojang's authlib wants it dashed.
export const undashUuid = (value: string): string => {
  if (isUuidUndashed(value)) return value.toLowerCase();
  if (isUuidDashed(value)) return value.replace(/-/g, '').toLowerCase();
  return rejectUuid(value);
};

export const dashUuid = (value: string): string => {
  if (isUuidDashed(value)) return value.toLowerCase();
  if (!isUuidUndashed(value)) return rejectUuid(value);
  const v = value.toLowerCase();
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
};

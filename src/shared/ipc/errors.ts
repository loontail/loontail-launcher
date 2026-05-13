import { ERROR_CODES, type ErrorCode } from '@shared/constants/errorCodes';

export type IpcError = {
  code: ErrorCode;
  message: string;
  details?: unknown;
};

export const isIpcError = (value: unknown): value is IpcError => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    Object.values(ERROR_CODES).includes(candidate.code as ErrorCode)
  );
};

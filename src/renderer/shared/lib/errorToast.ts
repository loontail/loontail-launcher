import { type IpcError, isIpcError } from '@shared/ipc';

export type IpcErrorLocalizer = (error: IpcError) => string;

// Best-effort string for arbitrary error shapes so plain throw-objects never
// collapse to "[object Object]".
const formatError = (error: unknown): string => {
  if (isIpcError(error)) return error.message;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const maybe = (error as Record<string, unknown>).message;
    if (typeof maybe === 'string' && maybe.length > 0) return maybe;
  }
  return String(error);
};

// A mutation tags itself with `meta.errorLocalizer` to localize its coded
// rejections; the localizer is injected by the owning feature so renderer/shared
// never imports a feature. Un-coded or untagged errors fall through to formatError.
export const resolveErrorToastMessage = (
  error: unknown,
  localizer: IpcErrorLocalizer | undefined,
): string => {
  if (isIpcError(error) && localizer) return localizer(error);
  return formatError(error);
};

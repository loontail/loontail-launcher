import { type IpcError, isIpcError } from '@shared/ipc';

export type IpcErrorLocalizer = (error: IpcError) => string;

// Best-effort string for arbitrary error shapes — covers IpcError ({code,
// message}), Error instances, and as a last resort anything with a string
// `message` so plain throw-objects never collapse to "[object Object]".
const formatError = (error: unknown): string => {
  if (isIpcError(error)) return error.message;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const maybe = (error as Record<string, unknown>).message;
    if (typeof maybe === 'string' && maybe.length > 0) return maybe;
  }
  return String(error);
};

// A mutation tags itself with `meta.errorLocalizer` to opt its coded rejections
// into a domain localizer (the same code→key map the live event listener uses),
// so a NO_ACCOUNT/offline launch shows one localized toast instead of the raw
// English `message`. Un-coded errors or untagged mutations fall through to
// formatError. The localizer lives in the feature that owns the mutation, so
// renderer/shared never imports a feature.
export const resolveErrorToastMessage = (
  error: unknown,
  localizer: IpcErrorLocalizer | undefined,
): string => {
  if (isIpcError(error) && localizer) return localizer(error);
  return formatError(error);
};

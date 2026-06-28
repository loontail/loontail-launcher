export type IpcError = {
  code: string;
  message: string;
  details?: unknown;
};

// Validates shape only: gating on a closed code registry would silently drop any
// code the main process adds and collapse the structured error into "[object
// Object]" in the renderer.
export const isIpcError = (value: unknown): value is IpcError => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.message === 'string'
  );
};

// Marker for shipping a structured IpcError through Electron's IPC, which
// otherwise drops everything but `Error.message`. The preload's `invoke` finds
// this sentinel in the rejection message and rehydrates the JSON payload.
export const IPC_ERROR_SENTINEL = '__LOONTAIL_IPC_ERROR__';

export const tryUnwrapIpcError = (raw: string): IpcError | null => {
  const idx = raw.indexOf(IPC_ERROR_SENTINEL);
  if (idx === -1) return null;
  const payload = raw.slice(idx + IPC_ERROR_SENTINEL.length);
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (isIpcError(parsed)) return parsed;
  } catch {
    // fall through
  }
  return null;
};

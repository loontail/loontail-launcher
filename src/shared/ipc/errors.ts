export type IpcError = {
  code: string;
  message: string;
  details?: unknown;
};

// The router authenticates the payload with IPC_ERROR_SENTINEL before it ever
// reaches the unwrap path, so provenance is already proven. Validate the shape
// only — gating on a closed code registry would silently drop any code main
// adds (domain codes, freshly added ones) and collapse the structured error
// into a raw "[object Object]" Error in the renderer.
export const isIpcError = (value: unknown): value is IpcError => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.message === 'string'
  );
};

// Marker used by the main-process router to ship a structured IpcError
// through Electron's IPC, which otherwise drops everything but `Error.message`
// (a plain `{code,message}` throw round-trips as "[object Object]"). The
// preload's `invoke` looks for this sentinel in the rejection message and
// rehydrates the JSON payload back into a real `IpcError`.
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

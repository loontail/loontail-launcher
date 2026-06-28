import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

// Move `tmpPath` onto `destPath` so readers see the previous or new file, never
// a half-written one. The destination is removed first because Windows
// `fs.rename` rejects an existing target. On failure the stray tmp is cleaned up
// best-effort and the original error rethrown.
export const atomicReplace = async (
  tmpPath: string,
  destPath: string,
  onCleanupError?: (error: unknown) => void,
): Promise<void> => {
  try {
    await fs.rm(destPath, { force: true });
    await fs.rename(tmpPath, destPath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch((cleanupError: unknown) => {
      onCleanupError?.(cleanupError);
    });
    throw error;
  }
};

// Write `value` as pretty JSON to `target` via a sibling `.tmp` + atomic rename.
// A mid-write failure cleans up the stray tmp best-effort and rethrows.
export const writeJsonAtomic = async (
  target: string,
  value: unknown,
  onCleanupError?: (error: unknown) => void,
): Promise<void> => {
  const tmp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch((cleanupError: unknown) => {
      onCleanupError?.(cleanupError);
    });
    throw error;
  }
  await atomicReplace(tmp, target, onCleanupError);
};

// Read and Zod-validate a JSON file. Returns null (never throws) for missing,
// malformed, or unreadable files so one bad file can't break a whole listing.
export const readJsonValidated = async <S extends z.ZodTypeAny>(
  target: string,
  schema: S,
  handlers: {
    onInvalid?: () => void;
    onReadError?: (error: unknown) => void;
  } = {},
): Promise<z.output<S> | null> => {
  try {
    const raw = await fs.readFile(target, 'utf8');
    const parsed = schema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      handlers.onInvalid?.();
      return null;
    }
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    handlers.onReadError?.(error);
    return null;
  }
};

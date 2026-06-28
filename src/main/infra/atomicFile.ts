import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

// Atomically move the file already written at `tmpPath` onto `destPath`: readers
// see either the previous or the new file, never a half-written one. The
// destination is removed first because Windows `fs.rename` rejects an existing
// target (idempotent on ENOENT). On failure the stray tmp is removed
// best-effort (`onCleanupError` observes a cleanup failure) and the original
// error is rethrown for the caller to classify.
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

// Write `value` as pretty JSON to `target` atomically: ensure the parent dir
// exists, write a sibling `.tmp`, then atomically replace `target` with it
// (temp + rename). A mid-write failure removes the stray tmp best-effort
// (`onCleanupError` observes a cleanup failure) and rethrows for the caller.
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

// Read and Zod-validate a JSON file. Returns null (never throws) for the three
// non-fatal cases so callers can skip/discard one bad file without breaking the
// whole listing: a missing file (ENOENT, silent), a malformed/invalid file
// (`onInvalid` observes it), or an unexpected read failure (`onReadError`).
// Generic over the schema so the resolved value carries its branded output type.
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

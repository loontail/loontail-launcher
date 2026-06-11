import fs from 'node:fs/promises';

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

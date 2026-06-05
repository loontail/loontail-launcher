import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const VERSIONS_DIR = 'versions';

// Legacy fallback scan: the durable install manifest is the fast current-target
// proof, but this keeps cancel/uninstall recovery tolerant of old installs.
export const isAnythingInstalled = async (clientFolder: string): Promise<boolean> => {
  if (!clientFolder) return false;
  const versionsRoot = path.join(clientFolder, VERSIONS_DIR);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(versionsRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  const probes = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => fs.access(path.join(versionsRoot, entry.name, `${entry.name}.json`)));
  if (probes.length === 0) return false;
  // Promise.any short-circuits on the first present version JSON; it rejects
  // (AggregateError) only when every probe failed, i.e. nothing is installed.
  try {
    await Promise.any(probes);
    return true;
  } catch {
    return false;
  }
};

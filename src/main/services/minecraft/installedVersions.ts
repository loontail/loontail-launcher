import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const VERSIONS_DIR = 'versions';

// Legacy fallback scan, kept so cancel/uninstall recovery tolerates installs
// that predate the durable install manifest.
export const hasAnyVersionInstalled = async (clientFolder: string): Promise<boolean> => {
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
  try {
    await Promise.any(probes);
    return true;
  } catch {
    return false;
  }
};

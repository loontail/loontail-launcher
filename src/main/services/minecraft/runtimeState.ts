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
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(versionsRoot, entry.name, `${entry.name}.json`);
    try {
      await fs.access(jsonPath);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
};

import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { type Target, resolveLaunchVersion } from '@loontail/minecraft-kit';

const VERSIONS_DIR = 'versions';

// "Installed" = the client folder has at least one `versions/<id>/<id>.json`.
// No sidecar state file; the kit's own output is the source of truth.
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

// "Ready" = the on-disk version JSONs satisfy the current target's loader chain.
// Throws-on-miss inside kit, so a catch maps to "needs install".
export const isTargetReady = async (target: Target): Promise<boolean> => {
  try {
    await resolveLaunchVersion(target);
    return true;
  } catch {
    return false;
  }
};

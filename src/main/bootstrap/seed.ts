import { computeDefaultRamMb, ensureDirectory } from '@main/infra/system';
import { getSettings, writeSettings } from '@main/services/settings/settings';

export const seedLauncherSettings = (): void => {
  const current = getSettings();
  let next = current;

  if (next.memory.allocatedRamMb === 0) {
    const seeded = computeDefaultRamMb();
    if (seeded > 0) {
      next = { ...next, memory: { ...next.memory, allocatedRamMb: seeded } };
    }
  }

  if (next !== current) {
    next = writeSettings(next);
  }

  if (next.storage.clientsFolder) {
    ensureDirectory(next.storage.clientsFolder);
  }
};

import { catalogKeyToRefValue } from '@shared/contracts/catalog';
import type { CatalogKey } from '@shared/contracts/ids';
import type { LauncherSettings } from '@shared/contracts/settings';

export const defaultLauncherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: '' },
  launch: { console: false, fullscreen: false },
  clients: {},
});

// The on-disk folder name MUST use the bare ref value, not the CatalogKey: `:`
// is an illegal Windows filename char, and re-keying would orphan every existing
// install. A malformed key is used as-is.
export const joinClientFolder = (clientsFolder: string, key: CatalogKey): string => {
  if (!clientsFolder) return '';
  const folderName = catalogKeyToRefValue(key) ?? (key as string);
  const separator = clientsFolder.endsWith('/') || clientsFolder.endsWith('\\') ? '' : '/';
  return `${clientsFolder}${separator}${folderName}`;
};

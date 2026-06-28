import { catalogKeyToRefValue } from '@shared/contracts/catalog';
import type { CatalogKey } from '@shared/contracts/ids';
import type { LauncherSettings } from '@shared/contracts/settings';

export const defaultLauncherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: '' },
  launch: { console: false, fullscreen: false },
  clients: {},
});

// The default install folder for a build. The settings record keys by CatalogKey
// (`official:<slug>` / `local:<uuid>`), but the on-disk folder name MUST use the
// bare ref value: `:` is an illegal Windows filename char and re-keying would
// orphan every existing install. A bare (pre-migration) key is used as-is.
export const joinClientFolder = (clientsFolder: string, key: CatalogKey): string => {
  if (!clientsFolder) return '';
  const folderName = catalogKeyToRefValue(key) ?? (key as string);
  const separator = clientsFolder.endsWith('/') || clientsFolder.endsWith('\\') ? '' : '/';
  return `${clientsFolder}${separator}${folderName}`;
};

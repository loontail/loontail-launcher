import type { ClientSlug } from '@shared/contracts/ids';
import type { LauncherSettings } from '@shared/contracts/settings';

export const defaultLauncherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: '' },
  launch: { console: false, fullscreen: false },
  clients: {},
});

export const joinClientFolder = (clientsFolder: string, slug: ClientSlug): string => {
  if (!clientsFolder) return '';
  const separator = clientsFolder.endsWith('/') || clientsFolder.endsWith('\\') ? '' : '/';
  return `${clientsFolder}${separator}${slug}`;
};

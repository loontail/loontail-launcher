import { useLauncherSettings } from '@renderer/features/settings';

export type SetupGate = {
  needsSetup: boolean;
  isPending: boolean;
};

export const useNeedsSetup = (): SetupGate => {
  const { settings, isPending } = useLauncherSettings();
  const clientsFolder = settings?.storage.clientsFolder ?? '';
  return {
    needsSetup: !isPending && clientsFolder.length === 0,
    isPending,
  };
};

import { QUERY_KEYS } from '@shared/constants';
import type { BundleSlug } from '@shared/contracts/ids';
import type {
  ClientSettingsOverride,
  LauncherSettings,
  PatchLauncherSettings,
} from '@shared/contracts/settings';
import { resolveClientSettings } from '@shared/domain/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  chooseClientFolder,
  clearClientOverrides,
  getSettings,
  setClientOverride,
  setLauncher,
} from './api';
import { getDiskSpace, getRamRange, openPath, pickInstallFolder } from './systemApi';

export const useLauncherSettings = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.settings.root,
    queryFn: getSettings,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { settings: query.data, isPending: query.isPending };
};

export const useSetLauncher = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: setLauncher,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEYS.settings.root, next);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useSetClientOverride = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      bundleSlug,
      patch,
    }: {
      bundleSlug: BundleSlug;
      patch: ClientSettingsOverride;
    }) => setClientOverride(bundleSlug, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEYS.settings.root, next);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useClearClientOverrides = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: clearClientOverrides,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEYS.settings.root, next);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useChooseClientFolder = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: chooseClientFolder,
    onSuccess: (result) => {
      if (result) queryClient.setQueryData(QUERY_KEYS.settings.root, result.settings);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const usePickInstallFolder = () => {
  const queryClient = useQueryClient();
  const setLauncherMutation = useMutation<LauncherSettings, Error, PatchLauncherSettings>({
    mutationFn: setLauncher,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEYS.settings.root, next);
    },
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const picked = await pickInstallFolder();
      if (!picked) return;
      await setLauncherMutation.mutateAsync({ storage: { clientsFolder: picked.path } });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.system.diskSpaceRoot });
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useOpenPath = () => openPath;

export const useRamRange = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.system.ramRange,
    queryFn: getRamRange,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { range: query.data, isPending: query.isPending };
};

export const useDiskSpace = (path: string | undefined | null) => {
  const query = useQuery({
    queryKey: QUERY_KEYS.system.diskSpace(path ?? ''),
    queryFn: () => getDiskSpace(path ?? ''),
    enabled: typeof path === 'string' && path.length > 0,
    staleTime: 30_000,
  });
  return { info: query.data, isPending: query.isPending };
};

export const useResolveFor = (bundleSlug: BundleSlug | null | undefined) => {
  const { settings } = useLauncherSettings();
  return settings ? resolveClientSettings(settings, bundleSlug) : null;
};

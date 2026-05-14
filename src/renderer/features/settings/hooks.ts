import type {
  ClientSettingsOverride,
  LauncherSettings,
  PatchLauncherSettings,
  ResolvedClientSettings,
} from '@shared/contracts/settings';
import type { DiskInfo } from '@shared/contracts/system';
import { resolveClientSettings } from '@shared/domain/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  chooseClientFolder,
  clearClientOverrides,
  getSettings,
  setClientOverride,
  setLauncher,
} from './api';
import { getDiskSpace, getRamRange, openPath, pickInstallFolder } from './systemApi';

const SETTINGS_KEY = ['settings'] as const;
const RAM_RANGE_KEY = ['system', 'ramRange'] as const;
const DISK_SPACE_KEY = (path: string): readonly unknown[] => ['system', 'diskSpace', path];

export const useLauncherSettings = (): {
  settings: LauncherSettings | undefined;
  isPending: boolean;
} => {
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: getSettings,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { settings: query.data, isPending: query.isPending };
};

export const useSetLauncher = (): {
  mutate: (patch: PatchLauncherSettings) => Promise<LauncherSettings>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: setLauncher,
    onSuccess: (next) => {
      queryClient.setQueryData(SETTINGS_KEY, next);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useSetClientOverride = (): {
  mutate: (args: {
    bundleSlug: string;
    patch: ClientSettingsOverride;
  }) => Promise<LauncherSettings>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ bundleSlug, patch }: { bundleSlug: string; patch: ClientSettingsOverride }) =>
      setClientOverride(bundleSlug, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(SETTINGS_KEY, next);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useClearClientOverrides = (): {
  mutate: (bundleSlug: string) => Promise<LauncherSettings>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: clearClientOverrides,
    onSuccess: (next) => {
      queryClient.setQueryData(SETTINGS_KEY, next);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useChooseClientFolder = (): {
  mutate: (
    bundleSlug: string,
  ) => Promise<{ settings: LauncherSettings; installed: boolean } | null>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: chooseClientFolder,
    onSuccess: (result) => {
      if (result) queryClient.setQueryData(SETTINGS_KEY, result.settings);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const usePickInstallFolder = (): {
  mutate: () => Promise<void>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const setLauncherMutation = useMutation({
    mutationFn: setLauncher,
    onSuccess: (next) => {
      queryClient.setQueryData(SETTINGS_KEY, next);
    },
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const picked = await pickInstallFolder();
      if (!picked) return;
      await setLauncherMutation.mutateAsync({ storage: { clientsFolder: picked.path } });
      void queryClient.invalidateQueries({ queryKey: ['system', 'diskSpace'] });
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useOpenPath = (): ((path: string) => Promise<void>) => openPath;

export const useRamRange = (): { range: number[] | undefined; isPending: boolean } => {
  const query = useQuery({
    queryKey: RAM_RANGE_KEY,
    queryFn: getRamRange,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { range: query.data, isPending: query.isPending };
};

export const useDiskSpace = (
  path: string | undefined | null,
): {
  info: DiskInfo | undefined;
  isPending: boolean;
} => {
  const query = useQuery({
    queryKey: DISK_SPACE_KEY(path ?? ''),
    queryFn: () => getDiskSpace(path ?? ''),
    enabled: typeof path === 'string' && path.length > 0,
    staleTime: 30_000,
  });
  return { info: query.data, isPending: query.isPending };
};

export const useResolveFor = (
  bundleSlug: string | null | undefined,
): ResolvedClientSettings | null => {
  const { settings } = useLauncherSettings();
  return useMemo(
    () => (settings ? resolveClientSettings(settings, bundleSlug) : null),
    [settings, bundleSlug],
  );
};

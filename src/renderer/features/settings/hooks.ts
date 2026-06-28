import { i18n } from '@renderer/i18n';
import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEYS } from '@shared/constants';
import type { CatalogKey } from '@shared/contracts/ids';
import type { ClientSettingsOverride, LauncherSettings } from '@shared/contracts/settings';
import { resolveClientSettings } from '@shared/domain/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  chooseClientFolder,
  clearClientOverrides,
  getSettings,
  setClientOverride,
  setLauncher,
} from './api';
import { clearMediaCache, getMediaCacheSize } from './mediaApi';
import { getDiskSpace, getFolderSize, getRamRange, pickInstallFolder } from './systemApi';

const DISK_SPACE_STALE_TIME_MS = 30_000;
const DISK_SPACE_DEBOUNCE_MS = 300;
const FOLDER_SIZE_STALE_TIME_MS = 60_000;
// Main-side mutations (e.g. runtime path stored after install) bypass the IPC
// mutation channel that calls `setQueryData`. Refetch periodically so the
// renderer eventually picks them up without a manual reload.
const LAUNCHER_SETTINGS_STALE_TIME_MS = 5 * 60 * 1000;

const useLauncherSettingsMutation = <TInput>(
  mutationFn: (input: TInput) => Promise<LauncherSettings>,
) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEYS.settings.root, next);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useLauncherSettings = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.settings.root,
    queryFn: getSettings,
    staleTime: LAUNCHER_SETTINGS_STALE_TIME_MS,
  });
  return { settings: query.data, isPending: query.isPending };
};

export const useSetLauncher = () => useLauncherSettingsMutation(setLauncher);

export const useSetClientOverride = () =>
  useLauncherSettingsMutation(
    ({ slug, patch }: { slug: CatalogKey; patch: ClientSettingsOverride }) =>
      setClientOverride(slug, patch),
  );

export const useClearClientOverrides = () => useLauncherSettingsMutation(clearClientOverrides);

export const useChooseClientFolder = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: chooseClientFolder,
    onSuccess: (result) => {
      if (!result) return;
      queryClient.setQueryData(QUERY_KEYS.settings.root, result.settings);
      toast.success(i18n.t('clientSettings.folderChangedToast'));
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const usePickInstallFolder = () => {
  const queryClient = useQueryClient();
  const { mutate: applyLauncher } = useSetLauncher();
  const mutation = useMutation({
    mutationFn: async () => {
      const picked = await pickInstallFolder();
      if (!picked) return false;
      await applyLauncher({ storage: { clientsFolder: picked.path } });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.system.diskSpaceRoot });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.system.folderSizeRoot });
      return true;
    },
    onSuccess: (changed) => {
      if (changed) toast.success(i18n.t('settings.system.folderChangedToast'));
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useRamRange = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.system.ramRange,
    queryFn: getRamRange,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { range: query.data, isPending: query.isPending };
};

const useDebouncedValue = <T>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
};

// Shared shape for the path-sized lookups: debounce the path (so rapid client
// switching doesn't fan out N IPC calls), then run an enabled, path-keyed query.
const useDebouncedPathQuery = <T>(config: {
  path: string | undefined | null;
  staleTime: number;
  queryKey: (path: string) => readonly unknown[];
  fetch: (path: string) => Promise<T>;
}) => {
  const resolved = useDebouncedValue(config.path, DISK_SPACE_DEBOUNCE_MS) ?? '';
  const query = useQuery({
    queryKey: config.queryKey(resolved),
    queryFn: () => config.fetch(resolved),
    enabled: resolved.length > 0,
    staleTime: config.staleTime,
  });
  return { info: query.data, isPending: query.isPending };
};

export const useDiskSpace = (path: string | undefined | null) =>
  useDebouncedPathQuery({
    path,
    staleTime: DISK_SPACE_STALE_TIME_MS,
    queryKey: QUERY_KEYS.system.diskSpace,
    fetch: getDiskSpace,
  });

export const useFolderSize = (path: string | undefined | null) =>
  useDebouncedPathQuery({
    path,
    staleTime: FOLDER_SIZE_STALE_TIME_MS,
    queryKey: QUERY_KEYS.system.folderSize,
    fetch: getFolderSize,
  });

export const useResolveFor = (key: CatalogKey | null | undefined) => {
  const { settings } = useLauncherSettings();
  return settings ? resolveClientSettings(settings, key) : null;
};

const MEDIA_CACHE_SIZE_STALE_TIME_MS = 30_000;

export const useMediaCacheSize = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.media.cacheSize,
    queryFn: getMediaCacheSize,
    staleTime: MEDIA_CACHE_SIZE_STALE_TIME_MS,
  });
  return { bytes: query.data, isPending: query.isPending };
};

export const useClearMediaCache = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: clearMediaCache,
    onSuccess: () => {
      queryClient.setQueryData(QUERY_KEYS.media.cacheSize, 0);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

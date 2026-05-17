import { i18n } from '@renderer/i18n';
import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEYS } from '@shared/constants';
import type { ClientSlug } from '@shared/contracts/ids';
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
import { getDiskSpace, getFolderSize, getRamRange, pickInstallFolder } from './systemApi';

const DISK_SPACE_STALE_TIME_MS = 30_000;
const DISK_SPACE_DEBOUNCE_MS = 300;
const FOLDER_SIZE_STALE_TIME_MS = 60_000;

// Common settings-mutation pattern. `extract` lets a mutation return a wrapper
// shape and still feed only the settings part into the cache.
const useLauncherSettingsMutation = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  extract: (result: TResult) => LauncherSettings | null = (result) =>
    result as unknown as LauncherSettings,
) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn,
    onSuccess: (result) => {
      const next = extract(result);
      if (next) queryClient.setQueryData(QUERY_KEYS.settings.root, next);
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useLauncherSettings = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.settings.root,
    queryFn: getSettings,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { settings: query.data, isPending: query.isPending };
};

export const useSetLauncher = () => useLauncherSettingsMutation(setLauncher);

export const useSetClientOverride = () =>
  useLauncherSettingsMutation(
    ({ slug, patch }: { slug: ClientSlug; patch: ClientSettingsOverride }) =>
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

export const useDiskSpace = (path: string | undefined | null) => {
  // Debounce so rapid client switching doesn't fan out N IPC calls.
  const [debouncedPath, setDebouncedPath] = useState<string | undefined | null>(path);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedPath(path), DISK_SPACE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [path]);
  const query = useQuery({
    queryKey: QUERY_KEYS.system.diskSpace(debouncedPath ?? ''),
    queryFn: () => getDiskSpace(debouncedPath ?? ''),
    enabled: typeof debouncedPath === 'string' && debouncedPath.length > 0,
    staleTime: DISK_SPACE_STALE_TIME_MS,
  });
  return { info: query.data, isPending: query.isPending };
};

export const useFolderSize = (path: string | undefined | null) => {
  const [debouncedPath, setDebouncedPath] = useState<string | undefined | null>(path);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedPath(path), DISK_SPACE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [path]);
  const query = useQuery({
    queryKey: QUERY_KEYS.system.folderSize(debouncedPath ?? ''),
    queryFn: () => getFolderSize(debouncedPath ?? ''),
    enabled: typeof debouncedPath === 'string' && debouncedPath.length > 0,
    staleTime: FOLDER_SIZE_STALE_TIME_MS,
  });
  return { info: query.data, isPending: query.isPending };
};

export const useResolveFor = (slug: ClientSlug | null | undefined) => {
  const { settings } = useLauncherSettings();
  return settings ? resolveClientSettings(settings, slug) : null;
};

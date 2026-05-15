import { QUERY_KEYS } from '@shared/constants';
import type { BundleSlug } from '@shared/contracts/ids';
import type { ClientSettingsOverride, LauncherSettings } from '@shared/contracts/settings';
import { resolveClientSettings } from '@shared/domain/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  chooseClientFolder,
  clearClientOverrides,
  getSettings,
  setClientOverride,
  setLauncher,
} from './api';
import { getDiskSpace, getRamRange, pickInstallFolder } from './systemApi';

const DISK_SPACE_STALE_TIME_MS = 30_000;

/**
 * Wraps the four near-identical "settings mutation" patterns: run the IPC call,
 * push the resulting `LauncherSettings` into the cache, expose `{mutate,isPending}`.
 * The optional `extract` lets a mutation return a wrapper shape
 * (e.g. `chooseClientFolder` → `{settings, installed}`) and still feed only the
 * settings part into the cache; returns `null` to skip the cache update.
 */
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
    ({ bundleSlug, patch }: { bundleSlug: BundleSlug; patch: ClientSettingsOverride }) =>
      setClientOverride(bundleSlug, patch),
  );

export const useClearClientOverrides = () => useLauncherSettingsMutation(clearClientOverrides);

export const useChooseClientFolder = () =>
  useLauncherSettingsMutation(chooseClientFolder, (result) => result?.settings ?? null);

export const usePickInstallFolder = () => {
  const queryClient = useQueryClient();
  const { mutate: applyLauncher } = useSetLauncher();
  const mutation = useMutation({
    mutationFn: async () => {
      const picked = await pickInstallFolder();
      if (!picked) return;
      await applyLauncher({ storage: { clientsFolder: picked.path } });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.system.diskSpaceRoot });
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
  const query = useQuery({
    queryKey: QUERY_KEYS.system.diskSpace(path ?? ''),
    queryFn: () => getDiskSpace(path ?? ''),
    enabled: typeof path === 'string' && path.length > 0,
    staleTime: DISK_SPACE_STALE_TIME_MS,
  });
  return { info: query.data, isPending: query.isPending };
};

export const useResolveFor = (bundleSlug: BundleSlug | null | undefined) => {
  const { settings } = useLauncherSettings();
  return settings ? resolveClientSettings(settings, bundleSlug) : null;
};

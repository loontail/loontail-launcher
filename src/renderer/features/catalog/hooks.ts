import { QUERY_KEY_ROOTS, QUERY_KEYS } from '@shared/constants';
import { type CatalogItem, SourceKinds } from '@shared/contracts/catalog';
import type { LoaderChoice } from '@shared/contracts/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from './api';

const CATALOG_STALE_TIME_MS = 60_000;
const VERSIONS_STALE_TIME_MS = 5 * 60 * 1000;

export type UseCatalogResult = {
  items: CatalogItem[];
  // False → show a degraded banner; local builds always render regardless.
  officialOk: boolean;
  isPending: boolean;
  // True during background refetches too, so consumers can wait out a
  // just-created build landing.
  isFetching: boolean;
  isError: boolean;
};

export const useCatalog = (): UseCatalogResult => {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const query = useQuery({
    queryKey: QUERY_KEYS.catalog.list(locale),
    queryFn: () => api.getCatalog(locale),
    staleTime: CATALOG_STALE_TIME_MS,
  });
  const items = useMemo(() => query.data?.items.slice() ?? [], [query.data]);
  const officialOk =
    query.data?.sources.find((source) => source.id === SourceKinds.OFFICIAL)?.ok ?? true;
  return {
    items,
    officialOk,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
  };
};

const useCatalogMutation = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  meta?: Record<string, unknown>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    ...(meta ? { meta } : {}),
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOTS.catalog] });
    },
  });
};

// The build editor surfaces creation failures inline, so suppress the global toast.
export const useCreateBuild = () =>
  useCatalogMutation(api.createBuild, { skipGlobalErrorToast: true });
export const useDeleteBuild = () => useCatalogMutation(api.deleteBuild);

export const useMinecraftVersions = (enabled: boolean) =>
  useQuery({
    queryKey: QUERY_KEYS.builds.minecraftVersions,
    queryFn: api.listMinecraftVersions,
    staleTime: VERSIONS_STALE_TIME_MS,
    enabled,
  });

export const useLoaderVersions = (
  loader: LoaderChoice,
  minecraftVersion: string,
  enabled: boolean,
) =>
  useQuery({
    queryKey: QUERY_KEYS.builds.loaderVersions(loader, minecraftVersion),
    queryFn: () => api.listLoaderVersions({ loader, minecraftVersion }),
    staleTime: VERSIONS_STALE_TIME_MS,
    enabled: enabled && minecraftVersion.length > 0,
  });

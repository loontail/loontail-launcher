import type { CatalogItem, CatalogListResult } from '@shared/contracts/catalog';
import type { InstanceId } from '@shared/contracts/ids';
import type {
  CreateInstancePayload,
  ListLoaderVersionsArgs,
  LoaderVersionOption,
  MinecraftVersionOption,
} from '@shared/contracts/instance';
import { IPC_CHANNELS } from '@shared/ipc';

export const getCatalog = (locale?: string): Promise<CatalogListResult> =>
  window.api.invoke(IPC_CHANNELS.catalogList, locale ? { locale } : {});

export const createBuild = (payload: CreateInstancePayload): Promise<CatalogItem> =>
  window.api.invoke(IPC_CHANNELS.buildsCreate, payload);

export const deleteBuild = (id: InstanceId): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.buildsDelete, id);

export const listMinecraftVersions = (): Promise<MinecraftVersionOption[]> =>
  window.api.invoke(IPC_CHANNELS.buildsListMinecraftVersions, undefined);

export const listLoaderVersions = (args: ListLoaderVersionsArgs): Promise<LoaderVersionOption[]> =>
  window.api.invoke(IPC_CHANNELS.buildsListLoaderVersions, args);

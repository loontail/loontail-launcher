import type { Account } from '@shared/contracts/account';
import type { LoginPayload, RegisterPayload } from '@shared/contracts/auth';
import type {
  BundleErrorEvent,
  BundleInstallState,
  BundleProgressEvent,
  BundleStartRequest,
  BundleStatusEvent,
} from '@shared/contracts/bundle';
import type { CatalogItem, CatalogListResult } from '@shared/contracts/catalog';
import type {
  ConsoleInitialPayload,
  ConsoleLine,
  ConsoleProcessState,
} from '@shared/contracts/console';
import type { CatalogKey, LocalBuildId } from '@shared/contracts/ids';
import type {
  CreateBuildPayload,
  ListLoaderVersionsArgs,
  LoaderVersionOption,
  MinecraftVersionOption,
  UpdateBuildPayload,
} from '@shared/contracts/localBuild';
import type {
  InstallRequest,
  InstallStatus,
  MinecraftErrorEvent,
  MinecraftProgressEvent,
  MinecraftStatusEvent,
} from '@shared/contracts/minecraft';
import type { NotificationPayload } from '@shared/contracts/notification';
import type { ServerStatus } from '@shared/contracts/serverStatus';
import type {
  LauncherSettings,
  PatchLauncherSettings,
  SetClientOverridePayload,
} from '@shared/contracts/settings';
import type { UploadSkinPayload, UploadSkinResult } from '@shared/contracts/skin';
import type { DiskInfo, FolderSize, PickedFolder } from '@shared/contracts/system';
import type { UpdaterStatusEvent } from '@shared/contracts/updater';

export type { UpdaterStatusEvent } from '@shared/contracts/updater';

export type IpcContract = {
  'app.getVersion': { args: undefined; result: string };
  'auth.login': { args: LoginPayload; result: Account };
  'auth.register': { args: RegisterPayload; result: Account };
  'auth.me': { args: undefined; result: Account | null };
  'auth.logout': { args: undefined; result: void };
  'auth.mojang.signIn': { args: undefined; result: Account };
  'auth.mojang.cancel': { args: undefined; result: void };
  'settings.get': { args: undefined; result: LauncherSettings };
  'settings.setLauncher': { args: PatchLauncherSettings; result: LauncherSettings };
  'settings.setClientOverride': { args: SetClientOverridePayload; result: LauncherSettings };
  'settings.clearClientOverrides': { args: CatalogKey; result: LauncherSettings };
  'settings.chooseClientFolder': {
    args: CatalogKey;
    result: { settings: LauncherSettings; installed: boolean } | null;
  };
  'system.getRamRange': { args: undefined; result: number[] };
  'system.getDiskSpace': { args: string; result: DiskInfo };
  'system.getFolderSize': { args: string; result: FolderSize };
  'system.pickInstallFolder': { args: undefined; result: PickedFolder | null };
  'system.getDefaultInstallFolder': { args: undefined; result: string };
  'system.openPath': { args: string; result: void };
  'system.copyText': { args: string; result: void };
  'media.uploadSkin': { args: UploadSkinPayload; result: UploadSkinResult };
  'media.clearSkin': { args: undefined; result: void };
  'media.clearCache': { args: undefined; result: void };
  'media.getCacheSize': { args: undefined; result: number };
  'catalog.list': { args: { locale?: string } | undefined; result: CatalogListResult };
  'builds.create': { args: CreateBuildPayload; result: CatalogItem };
  'builds.update': { args: UpdateBuildPayload; result: CatalogItem };
  'builds.delete': { args: LocalBuildId; result: void };
  'builds.listMinecraftVersions': { args: undefined; result: MinecraftVersionOption[] };
  'builds.listLoaderVersions': { args: ListLoaderVersionsArgs; result: LoaderVersionOption[] };
  'servers.getStatuses': { args: string[]; result: ServerStatus[] };
  'history.lastPlayed': { args: undefined; result: Record<string, number> };
  'minecraft.getStatus': {
    args: CatalogKey;
    result: { status: InstallStatus; paused: boolean };
  };
  'minecraft.install': { args: InstallRequest; result: void };
  'minecraft.pause': { args: CatalogKey; result: void };
  'minecraft.resume': { args: CatalogKey; result: void };
  'minecraft.cancel': { args: CatalogKey; result: void };
  'minecraft.repair': { args: CatalogKey; result: void };
  'minecraft.uninstall': { args: CatalogKey; result: void };
  'minecraft.launch': { args: CatalogKey; result: void };
  'minecraft.stop': { args: CatalogKey; result: void };
  'bundle.start': { args: BundleStartRequest; result: void };
  'bundle.pause': { args: CatalogKey; result: void };
  'bundle.resume': { args: CatalogKey; result: void };
  'bundle.cancel': { args: CatalogKey; result: void };
  'bundle.getStatus': { args: CatalogKey; result: BundleInstallState };
  'console.open': { args: undefined; result: void };
  'console.getInitial': { args: undefined; result: ConsoleInitialPayload };
  'console.clear': { args: undefined; result: void };
  'console.copyAll': { args: undefined; result: void };
  'console.copyText': { args: string; result: void };
  'updater.check': { args: undefined; result: void };
  'updater.install': { args: undefined; result: void };
};

export type IpcArgs<TChannel extends keyof IpcContract> = IpcContract[TChannel]['args'];
export type IpcResult<TChannel extends keyof IpcContract> = IpcContract[TChannel]['result'];

export type IpcEventPayloads = {
  'minecraft.status': MinecraftStatusEvent;
  'minecraft.progress': MinecraftProgressEvent;
  'minecraft.error': MinecraftErrorEvent;
  'bundle.status': BundleStatusEvent;
  'bundle.progress': BundleProgressEvent;
  'bundle.error': BundleErrorEvent;
  'updater.status': UpdaterStatusEvent;
  'app.notification': NotificationPayload;
  'console.lines': ConsoleLine[];
  'console.state': ConsoleProcessState;
  'console.bufferReset': null;
};

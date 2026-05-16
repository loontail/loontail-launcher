import type { Account } from '@shared/contracts/account';
import type { LoginPayload, LoginResult } from '@shared/contracts/auth';
import type { Client } from '@shared/contracts/client';
import type {
  ConsoleInitialPayload,
  ConsoleLine,
  ConsoleProcessState,
} from '@shared/contracts/console';
import type { ClientSlug } from '@shared/contracts/ids';
import type {
  InstallRequest,
  InstallStatus,
  MinecraftErrorEvent,
  MinecraftLogEvent,
  MinecraftProgressEvent,
  MinecraftStatusEvent,
} from '@shared/contracts/minecraft';
import type { ServerStatus } from '@shared/contracts/serverStatus';
import type {
  LauncherSettings,
  PatchLauncherSettings,
  SetClientOverridePayload,
} from '@shared/contracts/settings';
import type { UploadSkinPayload, UploadSkinResult } from '@shared/contracts/skin';
import type { StrapiList } from '@shared/contracts/strapi';
import type { DiskInfo, PickedFolder } from '@shared/contracts/system';

export type IpcContract = {
  'app.getVersion': { args: undefined; result: string };
  'auth.login': { args: LoginPayload; result: LoginResult };
  'auth.me': { args: undefined; result: Account | null };
  'auth.logout': { args: undefined; result: void };
  'settings.get': { args: undefined; result: LauncherSettings };
  'settings.setLauncher': { args: PatchLauncherSettings; result: LauncherSettings };
  'settings.setClientOverride': { args: SetClientOverridePayload; result: LauncherSettings };
  'settings.clearClientOverrides': { args: ClientSlug; result: LauncherSettings };
  'settings.chooseClientFolder': {
    args: ClientSlug;
    result: { settings: LauncherSettings; installed: boolean } | null;
  };
  'system.getRamRange': { args: undefined; result: number[] };
  'system.getDiskSpace': { args: string; result: DiskInfo };
  'system.pickInstallFolder': { args: undefined; result: PickedFolder | null };
  'system.openPath': { args: string; result: void };
  'media.uploadSkin': { args: UploadSkinPayload; result: UploadSkinResult };
  'media.clearSkin': { args: undefined; result: void };
  'clients.list': { args: { locale?: string } | undefined; result: StrapiList<Client> };
  'servers.getStatuses': { args: string[]; result: ServerStatus[] };
  'minecraft.getStatus': {
    args: ClientSlug;
    result: { status: InstallStatus; paused: boolean };
  };
  'minecraft.install': { args: InstallRequest; result: void };
  'minecraft.pause': { args: ClientSlug; result: void };
  'minecraft.resume': { args: ClientSlug; result: void };
  'minecraft.cancel': { args: ClientSlug; result: void };
  'minecraft.repair': { args: ClientSlug; result: void };
  'minecraft.uninstall': { args: ClientSlug; result: void };
  'minecraft.launch': { args: ClientSlug; result: void };
  'minecraft.stop': { args: ClientSlug; result: void };
  'console.getInitial': { args: undefined; result: ConsoleInitialPayload };
  'console.clear': { args: undefined; result: void };
  'console.copyAll': { args: undefined; result: void };
  'console.copyText': { args: string; result: void };
};

export type IpcArgs<TChannel extends keyof IpcContract> = IpcContract[TChannel]['args'];
export type IpcResult<TChannel extends keyof IpcContract> = IpcContract[TChannel]['result'];

export type IpcEventPayloads = {
  'minecraft.status': MinecraftStatusEvent;
  'minecraft.progress': MinecraftProgressEvent;
  'minecraft.log': MinecraftLogEvent;
  'minecraft.error': MinecraftErrorEvent;
  'console.lines': ConsoleLine[];
  'console.state': ConsoleProcessState;
  'console.bufferReset': null;
};

export type IpcEventPayload<E extends keyof IpcEventPayloads> = IpcEventPayloads[E];

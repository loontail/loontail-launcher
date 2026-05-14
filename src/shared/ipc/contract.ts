import type { Account } from '@shared/contracts/account';
import type { LoginPayload, LoginResult } from '@shared/contracts/auth';
import type {
  LauncherSettings,
  PatchLauncherSettings,
  SetClientOverridePayload,
} from '@shared/contracts/settings';
import type { UploadSkinPayload, UploadSkinResult } from '@shared/contracts/skin';
import type { DiskInfo, PickedFolder } from '@shared/contracts/system';

export type IpcContract = {
  'app.getVersion': { args: undefined; result: string };
  'auth.login': { args: LoginPayload; result: LoginResult };
  'auth.me': { args: undefined; result: Account | null };
  'auth.logout': { args: undefined; result: void };
  'settings.get': { args: undefined; result: LauncherSettings };
  'settings.setLauncher': { args: PatchLauncherSettings; result: LauncherSettings };
  'settings.setClientOverride': { args: SetClientOverridePayload; result: LauncherSettings };
  'settings.clearClientOverrides': { args: string; result: LauncherSettings };
  'settings.chooseClientFolder': {
    args: string;
    result: { settings: LauncherSettings; installed: boolean } | null;
  };
  'system.getRamRange': { args: undefined; result: number[] };
  'system.getDiskSpace': { args: string; result: DiskInfo };
  'system.pickInstallFolder': { args: undefined; result: PickedFolder | null };
  'system.openPath': { args: string; result: void };
  'media.uploadSkin': { args: UploadSkinPayload; result: UploadSkinResult };
  'media.clearSkin': { args: undefined; result: void };
};

export type IpcArgs<TChannel extends keyof IpcContract> = IpcContract[TChannel]['args'];
export type IpcResult<TChannel extends keyof IpcContract> = IpcContract[TChannel]['result'];

export type IpcEventPayloads = Record<never, never>;

export type IpcEventPayload<E extends keyof IpcEventPayloads> = IpcEventPayloads[E];

import type { IpcContract } from './contract';

export const IPC_CHANNELS = {
  appGetVersion: 'app.getVersion',
  authLogin: 'auth.login',
  authMe: 'auth.me',
  authLogout: 'auth.logout',
  authMojangSignIn: 'auth.mojang.signIn',
  authMojangCancel: 'auth.mojang.cancel',
  settingsGet: 'settings.get',
  settingsSetLauncher: 'settings.setLauncher',
  settingsSetClientOverride: 'settings.setClientOverride',
  settingsClearClientOverrides: 'settings.clearClientOverrides',
  settingsChooseClientFolder: 'settings.chooseClientFolder',
  systemGetRamRange: 'system.getRamRange',
  systemGetDiskSpace: 'system.getDiskSpace',
  systemGetFolderSize: 'system.getFolderSize',
  systemPickInstallFolder: 'system.pickInstallFolder',
  systemGetDefaultInstallFolder: 'system.getDefaultInstallFolder',
  systemOpenPath: 'system.openPath',
  systemCopyText: 'system.copyText',
  mediaUploadSkin: 'media.uploadSkin',
  mediaClearSkin: 'media.clearSkin',
  mediaClearCache: 'media.clearCache',
  mediaGetCacheSize: 'media.getCacheSize',
  clientsList: 'clients.list',
  serversGetStatuses: 'servers.getStatuses',
  minecraftGetStatus: 'minecraft.getStatus',
  minecraftInstall: 'minecraft.install',
  minecraftPause: 'minecraft.pause',
  minecraftResume: 'minecraft.resume',
  minecraftCancel: 'minecraft.cancel',
  minecraftRepair: 'minecraft.repair',
  minecraftUninstall: 'minecraft.uninstall',
  minecraftLaunch: 'minecraft.launch',
  minecraftStop: 'minecraft.stop',
  bundleStart: 'bundle.start',
  bundlePause: 'bundle.pause',
  bundleResume: 'bundle.resume',
  bundleCancel: 'bundle.cancel',
  bundleCheckStatus: 'bundle.checkStatus',
  consoleGetInitial: 'console.getInitial',
  consoleClear: 'console.clear',
  consoleCopyAll: 'console.copyAll',
  consoleCopyText: 'console.copyText',
  updaterCheck: 'updater.check',
  updaterInstall: 'updater.install',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// Channels the unsandboxed console window may invoke. Every other channel is
// denied to it so a renderer compromise there cannot reach the full IPC surface
// (auth.login, minecraft.launch, settings.setLauncher, system.openPath, …).
export const CONSOLE_CHANNEL_PREFIX = 'console.';

// Compile-time guard: every channel value must be a key in IpcContract, and
// every IpcContract key must appear as a channel value. Adding/removing a
// contract entry without updating IPC_CHANNELS (or vice versa) fails tsc.
type IpcChannelsCoverContract = Exclude<keyof IpcContract, IpcChannel> extends never
  ? Exclude<IpcChannel, keyof IpcContract> extends never
    ? true
    : ['channel missing in IpcContract:', Exclude<IpcChannel, keyof IpcContract>]
  : ['contract channel missing in IPC_CHANNELS:', Exclude<keyof IpcContract, IpcChannel>];

const _ipcChannelsCoverageCheck: IpcChannelsCoverContract = true;
void _ipcChannelsCoverageCheck;

export const IPC_EVENTS = {
  minecraftStatus: 'minecraft.status',
  minecraftProgress: 'minecraft.progress',
  minecraftLog: 'minecraft.log',
  minecraftError: 'minecraft.error',
  bundleStatus: 'bundle.status',
  bundleProgress: 'bundle.progress',
  bundleError: 'bundle.error',
  consoleLines: 'console.lines',
  consoleState: 'console.state',
  consoleBufferReset: 'console.bufferReset',
  updaterStatus: 'updater.status',
  appNotification: 'app.notification',
} as const;

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

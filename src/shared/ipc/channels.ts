import type { IpcContract, IpcEventPayloads } from './contract';

export const IPC_CHANNELS = {
  appGetVersion: 'app.getVersion',
  authLogin: 'auth.login',
  authRegister: 'auth.register',
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
  catalogList: 'catalog.list',
  buildsCreate: 'builds.create',
  buildsUpdate: 'builds.update',
  buildsDelete: 'builds.delete',
  buildsListMinecraftVersions: 'builds.listMinecraftVersions',
  buildsListLoaderVersions: 'builds.listLoaderVersions',
  serversGetStatuses: 'servers.getStatuses',
  historyLastPlayed: 'history.lastPlayed',
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
  consoleOpen: 'console.open',
  consoleGetInitial: 'console.getInitial',
  consoleClear: 'console.clear',
  consoleCopyAll: 'console.copyAll',
  consoleCopyText: 'console.copyText',
  updaterCheck: 'updater.check',
  updaterInstall: 'updater.install',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// Allowlist of channels the unsandboxed console window may invoke; every other
// channel is denied so a renderer compromise there cannot reach the full IPC
// surface. A new console.* channel is untrusted until added here, forcing a
// deliberate trust decision rather than an implicit prefix grant.
export const CONSOLE_TRUSTED_CHANNELS: ReadonlySet<IpcChannel> = new Set([
  IPC_CHANNELS.consoleGetInitial,
  IPC_CHANNELS.consoleClear,
  IPC_CHANNELS.consoleCopyAll,
  IPC_CHANNELS.consoleCopyText,
]);

// Compile-time guard: channel values and IpcContract keys must match exactly, so
// adding/removing one without the other fails tsc.
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

type IpcEventValue = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

// Compile-time guard: IPC_EVENTS values and IpcEventPayloads keys must match
// exactly, so adding or renaming an event without its payload type fails tsc.
type IpcEventsCoverPayloads = Exclude<keyof IpcEventPayloads, IpcEventValue> extends never
  ? Exclude<IpcEventValue, keyof IpcEventPayloads> extends never
    ? true
    : ['event missing in IpcEventPayloads:', Exclude<IpcEventValue, keyof IpcEventPayloads>]
  : ['payload event missing in IPC_EVENTS:', Exclude<keyof IpcEventPayloads, IpcEventValue>];

const _ipcEventsCoverageCheck: IpcEventsCoverPayloads = true;
void _ipcEventsCoverageCheck;

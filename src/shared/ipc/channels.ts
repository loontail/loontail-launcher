export const IPC_CHANNELS = {
  appGetVersion: 'app.getVersion',
  authLogin: 'auth.login',
  authMe: 'auth.me',
  authLogout: 'auth.logout',
  settingsGet: 'settings.get',
  settingsSetLauncher: 'settings.setLauncher',
  settingsSetClientOverride: 'settings.setClientOverride',
  settingsClearClientOverrides: 'settings.clearClientOverrides',
  settingsChooseClientFolder: 'settings.chooseClientFolder',
  systemGetRamRange: 'system.getRamRange',
  systemGetDiskSpace: 'system.getDiskSpace',
  systemPickInstallFolder: 'system.pickInstallFolder',
  systemOpenPath: 'system.openPath',
  mediaUploadSkin: 'media.uploadSkin',
  mediaClearSkin: 'media.clearSkin',
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
  consoleGetInitial: 'console.getInitial',
  consoleClear: 'console.clear',
  consoleCopyAll: 'console.copyAll',
  consoleCopyText: 'console.copyText',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const IPC_EVENTS = {
  minecraftStatus: 'minecraft.status',
  minecraftProgress: 'minecraft.progress',
  minecraftLog: 'minecraft.log',
  minecraftError: 'minecraft.error',
  consoleLines: 'console.lines',
  consoleState: 'console.state',
  consoleBufferReset: 'console.bufferReset',
} as const;

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

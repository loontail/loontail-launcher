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
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const IPC_EVENTS = {} as const;

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

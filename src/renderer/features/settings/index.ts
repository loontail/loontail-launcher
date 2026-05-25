export { SettingsPage } from './components/SettingsPage';

// Domain-tied controls exposed for reuse in the per-client settings modal.
// Generic atoms (group/row/override mark) live in shared/ui.
export { FolderInfoBlock } from './components/FolderInfoBlock';
export { LanguageSwitcher } from './components/LanguageSwitcher';
export { RamControl } from './components/RamControl';

export {
  useChooseClientFolder,
  useClearClientOverrides,
  useClearMediaCache,
  useDiskSpace,
  useFolderSize,
  useLauncherSettings,
  useMediaCacheSize,
  usePickInstallFolder,
  useRamRange,
  useResolveFor,
  useSetClientOverride,
  useSetLauncher,
} from './hooks';
export { openPath } from './systemApi';

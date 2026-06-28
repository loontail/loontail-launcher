import { createRuntimeStore } from '@renderer/shared/lib/stores/createRuntimeStore';
import {
  type InstallStatus,
  InstallStatuses,
  type MinecraftErrorCode,
  type ProgressStage,
} from '@shared/contracts/minecraft';

export type ClientRuntimeState = {
  status: InstallStatus;
  paused: boolean;
  stage?: ProgressStage | undefined;
  stagePercent?: number | undefined;
  overallPercent?: number | undefined;
  bytesDownloaded?: number | undefined;
  totalBytes?: number | undefined;
  speedBytesPerSec?: number | undefined;
  currentFile?: string | undefined;
  error?: { code: MinecraftErrorCode; message: string } | undefined;
};

export const DEFAULT_STATE: ClientRuntimeState = {
  status: InstallStatuses.UNKNOWN,
  paused: false,
};

const STATUSES_WITHOUT_PROGRESS: ReadonlySet<InstallStatus> = new Set([
  InstallStatuses.INSTALLED,
  InstallStatuses.NOT_INSTALLED,
  InstallStatuses.REPAIRING,
  InstallStatuses.RUNNING,
  InstallStatuses.ERROR,
  InstallStatuses.UNKNOWN,
  InstallStatuses.UNVERIFIED,
]);

const STATUSES_CLEAR_ERROR: ReadonlySet<InstallStatus> = new Set([
  InstallStatuses.INSTALLED,
  InstallStatuses.NOT_INSTALLED,
]);

const store = createRuntimeStore<InstallStatus, ClientRuntimeState>({
  default: DEFAULT_STATE,
  terminalStatuses: STATUSES_WITHOUT_PROGRESS,
  clearProgressFields: {
    stage: undefined,
    stagePercent: undefined,
    overallPercent: undefined,
    bytesDownloaded: undefined,
    totalBytes: undefined,
    speedBytesPerSec: undefined,
    currentFile: undefined,
  },
  clearErrorStatuses: STATUSES_CLEAR_ERROR,
  clearErrorFields: { error: undefined },
});

export const useMinecraftStore = store.useStore;
export const selectClient = store.selectEntry;

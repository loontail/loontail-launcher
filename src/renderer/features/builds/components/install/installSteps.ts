import type { BundleSyncState } from '@renderer/features/bundle';
import { isBundleBusy } from '@renderer/features/bundle/store';
import type { BuildInstallState } from '@renderer/features/minecraft';
import { type BundleSyncStatus, BundleSyncStatuses } from '@shared/contracts/bundle';
import { InstallStatuses, type ProgressStage, ProgressStages } from '@shared/contracts/minecraft';

export const InstallStepKeys = {
  RUNTIME: 'runtime',
  MINECRAFT: 'minecraft',
  LOADER: 'loader',
  BUNDLE: 'bundle',
} as const;

export type InstallStepKey = (typeof InstallStepKeys)[keyof typeof InstallStepKeys];

export const StepStates = {
  PENDING: 'pending',
  ACTIVE: 'active',
  DONE: 'done',
  PAUSED: 'paused',
  ERROR: 'error',
  SKIPPED: 'skipped',
} as const;

export type StepState = (typeof StepStates)[keyof typeof StepStates];

export type InstallStep = {
  key: InstallStepKey;
  state: StepState;
  // 0..100, only meaningful when state is ACTIVE or PAUSED.
  percent: number;
  // No determinate progress signal yet (manifest fetch, planning); UI shows a shimmer.
  indeterminate?: boolean;
  currentFile?: string;
  bytesDownloaded?: number;
  bytesTotal?: number;
  // Raw sub-stage id the UI maps to a localized label.
  subStage?: string;
};

export type ProgressControlsKind = 'install' | 'bundle' | null;

export type InstallProgressMode = 'install' | 'repair' | 'bundle';

export type InstallProgressView = {
  mode: InstallProgressMode;
  steps: InstallStep[];
  activeStep: InstallStepKey | null;
  paused: boolean;
  controls: ProgressControlsKind;
  // False for a launch-time bundle sync: pausing it would freeze the Play flow.
  pausable: boolean;
};

// `finalize` folds into the last scheduled step (loader if present, else minecraft),
// because the install runner skips the loader stage when no loader is selected.
const stageToStep = (stage: ProgressStage, hasLoader: boolean): InstallStepKey => {
  if (stage === ProgressStages.PREPARE || stage === ProgressStages.RUNTIME) {
    return InstallStepKeys.RUNTIME;
  }
  if (stage === ProgressStages.LOADER) return InstallStepKeys.LOADER;
  if (stage === ProgressStages.FINALIZE) {
    return hasLoader ? InstallStepKeys.LOADER : InstallStepKeys.MINECRAFT;
  }
  return InstallStepKeys.MINECRAFT;
};

// Pre-download bundle phases emit status but no progress events; render an indeterminate bar.
const BUNDLE_INDETERMINATE: ReadonlySet<BundleSyncStatus> = new Set([
  BundleSyncStatuses.FETCHING_MANIFEST,
  BundleSyncStatuses.PLANNING,
  BundleSyncStatuses.DELETING,
  BundleSyncStatuses.HEALING,
]);

// The progress card is reserved for an actual transfer; only DOWNLOADING/PAUSED move bytes.
const isBundleDownloading = (status: BundleSyncStatus): boolean =>
  status === BundleSyncStatuses.DOWNLOADING || status === BundleSyncStatuses.PAUSED;

const clamp = (n: number): number => {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
};

const makeStep = (key: InstallStepKey): InstallStep => ({
  key,
  state: StepStates.PENDING,
  percent: 0,
});

// Skip undefined to respect exactOptionalPropertyTypes.
const applyProgress = (
  step: InstallStep,
  data: {
    percent: number;
    indeterminate?: boolean | undefined;
    currentFile?: string | undefined;
    bytesDownloaded?: number | undefined;
    bytesTotal?: number | undefined;
    subStage?: string | undefined;
  },
): void => {
  step.percent = clamp(data.percent);
  if (data.indeterminate !== undefined) step.indeterminate = data.indeterminate;
  if (data.currentFile !== undefined) step.currentFile = data.currentFile;
  if (data.bytesDownloaded !== undefined) step.bytesDownloaded = data.bytesDownloaded;
  if (data.bytesTotal !== undefined) step.bytesTotal = data.bytesTotal;
  if (data.subStage !== undefined) step.subStage = data.subStage;
};

const markPrecedingDone = (steps: InstallStep[], current: InstallStepKey): void => {
  for (const step of steps) {
    if (step.key === current) break;
    step.state = StepStates.DONE;
    step.percent = 100;
  }
};

const buildSteps = (hasLoader: boolean, hasBundle: boolean): InstallStep[] => [
  makeStep(InstallStepKeys.RUNTIME),
  makeStep(InstallStepKeys.MINECRAFT),
  ...(hasLoader ? [makeStep(InstallStepKeys.LOADER)] : []),
  ...(hasBundle ? [makeStep(InstallStepKeys.BUNDLE)] : []),
];

export const selectInstallProgress = (
  client: BuildInstallState,
  bundle: BundleSyncState,
  context: { hasBundle: boolean; hasLoader: boolean },
): InstallProgressView | null => {
  const installRunning = client.status === InstallStatuses.INSTALLING;
  const repairRunning = client.status === InstallStatuses.REPAIRING;
  // No transfer to render during checking/planning phases; return null so the caller shows a spinner.
  const hasDownloadBytes = (client.totalBytes ?? 0) > 0;
  const installDownloadRunning = installRunning && hasDownloadBytes;
  const repairDownloadRunning = repairRunning && hasDownloadBytes;
  const bundleBusy = context.hasBundle && isBundleBusy(bundle.status);
  const bundleDownloadRunning = bundleBusy && isBundleDownloading(bundle.status);

  if (!installDownloadRunning && !repairDownloadRunning && !bundleDownloadRunning) return null;

  const steps = buildSteps(context.hasLoader, context.hasBundle);

  let activeStep: InstallStepKey | null = null;
  let paused = false;
  let controls: ProgressControlsKind = null;
  let pausable = true;
  let mode: InstallProgressMode = 'install';

  if (installDownloadRunning || repairDownloadRunning) {
    mode = repairRunning ? 'repair' : 'install';
    paused = client.paused;
    // Repair is not user-cancellable; only install exposes pause/cancel controls.
    controls = installRunning ? 'install' : null;

    const stage = client.stage;
    let currentKey: InstallStepKey;
    if (stage) {
      currentKey = stageToStep(stage, context.hasLoader);
    } else {
      currentKey = repairRunning ? InstallStepKeys.MINECRAFT : InstallStepKeys.RUNTIME;
    }
    activeStep = currentKey;
    markPrecedingDone(steps, currentKey);
    const current = steps.find((s) => s.key === currentKey);
    if (current) {
      current.state = paused ? StepStates.PAUSED : StepStates.ACTIVE;
      applyProgress(current, {
        percent: client.stagePercent ?? 0,
        indeterminate: repairRunning && stage === undefined,
        currentFile: client.currentFile,
        bytesDownloaded: client.bytesDownloaded,
        bytesTotal: client.totalBytes,
        subStage: stage,
      });
    }
    if (repairRunning) {
      const bundleStep = steps.find((s) => s.key === InstallStepKeys.BUNDLE);
      if (bundleStep) bundleStep.state = StepStates.SKIPPED;
    }
  } else if (bundleDownloadRunning) {
    mode = 'bundle';
    paused = bundle.status === BundleSyncStatuses.PAUSED;
    controls = 'bundle';
    // Launch-time sync (LAUNCHING) offers Resume/Cancel only; pausing would freeze Play.
    pausable = client.status !== InstallStatuses.LAUNCHING;
    activeStep = InstallStepKeys.BUNDLE;
    markPrecedingDone(steps, InstallStepKeys.BUNDLE);
    const bundleStep = steps.find((s) => s.key === InstallStepKeys.BUNDLE);
    if (bundleStep) {
      const p = bundle.progress;
      const indeterminate = BUNDLE_INDETERMINATE.has(bundle.status) && !paused;
      const percent = p && p.bytesTotal > 0 ? (p.bytesDownloaded / p.bytesTotal) * 100 : 0;
      bundleStep.state = paused ? StepStates.PAUSED : StepStates.ACTIVE;
      applyProgress(bundleStep, {
        percent,
        indeterminate,
        currentFile: p?.currentFile,
        bytesDownloaded: p?.bytesDownloaded,
        bytesTotal: p?.bytesTotal,
        // PAUSED has no `builds.bundleStage.*` key; UI falls back to step title.
        subStage: paused ? undefined : bundle.status,
      });
    }
  }

  return { mode, steps, activeStep, paused, controls, pausable };
};

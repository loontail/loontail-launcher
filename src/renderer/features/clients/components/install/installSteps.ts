import type { BundleRuntimeState } from '@renderer/features/bundle';
import type { ClientRuntimeState } from '@renderer/features/minecraft';
import {
  BUSY_BUNDLE_STATUSES,
  type BundleSyncStatus,
  BundleSyncStatuses,
} from '@shared/contracts/bundle';
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
  // True when the active step has no determinate progress signal (manifest
  // fetch, planning) — the UI substitutes a shimmer for the bar.
  indeterminate?: boolean;
  currentFile?: string;
  bytesDownloaded?: number;
  bytesTotal?: number;
  // Bytes/sec from a runner that already tracks throughput (bundle). UI falls
  // back to a renderer-side moving average when this is absent (install path).
  speedBytesPerSec?: number;
  // Raw sub-stage id ("runtime"|"minecraft"|... for install, bundle status for bundle).
  // The UI maps this to a localized label.
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
};

// Stages map to user-facing steps. With a loader, kit emits dedicated `loader`
// events; without one, kit skips that stage entirely and runs `finalize` after
// `minecraft`. `finalize` is folded into the *last* step that's actually
// scheduled — loader if present, otherwise minecraft.
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

// Pre-download bundle phases have no per-byte progress signal — they emit
// status events but no progress events, so we render an indeterminate bar.
const BUNDLE_INDETERMINATE: ReadonlySet<BundleSyncStatus> = new Set([
  BundleSyncStatuses.FETCHING_MANIFEST,
  BundleSyncStatuses.PLANNING,
  BundleSyncStatuses.DELETING,
  BundleSyncStatuses.HEALING,
]);

const isBundleBusy = (status: BundleSyncStatus): boolean =>
  BUSY_BUNDLE_STATUSES.has(status) || status === BundleSyncStatuses.PAUSED;

// The progress card is reserved for an *actual transfer*. A bundle sync only
// downloads bytes in DOWNLOADING (and a PAUSED download that can resume); the
// fetch/plan/delete/heal phases just inspect or clean up, so they surface as a
// spinner instead. Mirrors how install/repair gate the card on `totalBytes`.
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
    speedBytesPerSec?: number | undefined;
    subStage?: string | undefined;
  },
): void => {
  step.percent = clamp(data.percent);
  if (data.indeterminate !== undefined) step.indeterminate = data.indeterminate;
  if (data.currentFile !== undefined) step.currentFile = data.currentFile;
  if (data.bytesDownloaded !== undefined) step.bytesDownloaded = data.bytesDownloaded;
  if (data.bytesTotal !== undefined) step.bytesTotal = data.bytesTotal;
  if (data.speedBytesPerSec !== undefined) step.speedBytesPerSec = data.speedBytesPerSec;
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

// Bytes coming from the install kit are mixed-scale: `bytesDownloaded` is
// install-wide, but `totalBytes` is just the current stage's total. Showing
// them together (e.g. "633 MB / 18 MB") looks nonsensical when the stage is
// small. We recover stage-level bytes from stagePercent + totalBytes so the
// "X / Y" line stays self-consistent.
const installStageBytes = (
  stageTotal: number,
  stagePercent: number,
): { done: number; total: number } => {
  if (stageTotal <= 0) return { done: 0, total: 0 };
  const done = (clamp(stagePercent) / 100) * stageTotal;
  return { done, total: stageTotal };
};

// Returns null when nothing is in progress — the card collapses immediately.
export const selectInstallProgress = (
  client: ClientRuntimeState,
  bundle: BundleRuntimeState,
  context: { hasBundle: boolean; hasLoader: boolean },
): InstallProgressView | null => {
  const installRunning = client.status === InstallStatuses.INSTALLING;
  const repairRunning = client.status === InstallStatuses.REPAIRING;
  // The card shows only once there is something to download. While an op is
  // still checking the build (install planning, repair verification, bundle
  // manifest fetch/planning) there is no transfer to render — the caller shows
  // a spinner and this returns null so no card mounts.
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
  let mode: InstallProgressMode = 'install';

  if (installDownloadRunning || repairDownloadRunning) {
    mode = repairRunning ? 'repair' : 'install';
    paused = client.paused;
    // Repair is not user-cancellable: it only refetches what verification found
    // broken, so it always runs to completion. Install keeps pause/cancel.
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
      const { done, total } = installStageBytes(client.totalBytes ?? 0, client.stagePercent ?? 0);
      current.state = paused ? StepStates.PAUSED : StepStates.ACTIVE;
      applyProgress(current, {
        percent: client.stagePercent ?? 0,
        indeterminate: repairRunning && stage === undefined,
        currentFile: client.currentFile,
        bytesDownloaded: done,
        bytesTotal: total,
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
        speedBytesPerSec: p?.speedBytesPerSec,
        // PAUSED has no `clients.bundleStage.*` key; UI falls back to step title.
        subStage: paused ? undefined : bundle.status,
      });
    }
  }

  return { mode, steps, activeStep, paused, controls };
};

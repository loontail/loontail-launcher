import type { BundleRuntimeState } from '@renderer/features/bundle';
import {
  InstallStepKeys,
  StepStates,
  selectInstallProgress,
} from '@renderer/features/clients/components/install/installSteps';
import type { ClientRuntimeState } from '@renderer/features/minecraft';
import { type BundleProgressEvent, BundleSyncStatuses } from '@shared/contracts/bundle';
import { asClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, ProgressStages } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const idleBundle = (): BundleRuntimeState => ({
  status: BundleSyncStatuses.UNKNOWN,
  installed: false,
  signatureMatches: true,
  progress: null,
});

const bundleAt = (
  status: BundleRuntimeState['status'],
  progress: BundleRuntimeState['progress'] = null,
): BundleRuntimeState => ({
  status,
  installed: true,
  signatureMatches: true,
  progress,
});

const installedClient = (): ClientRuntimeState => ({
  status: InstallStatuses.INSTALLED,
  paused: false,
});

describe('selectInstallProgress', () => {
  it('keeps install planning out of the download progress card', () => {
    const client: ClientRuntimeState = {
      status: InstallStatuses.INSTALLING,
      paused: false,
    };

    const view = selectInstallProgress(client, idleBundle(), {
      hasBundle: true,
      hasLoader: true,
    });

    expect(view).toBeNull();
  });

  it('shows the install progress card once bytes are flowing', () => {
    const client: ClientRuntimeState = {
      status: InstallStatuses.INSTALLING,
      paused: false,
      stage: ProgressStages.MINECRAFT,
      stagePercent: 30,
      overallPercent: 30,
      bytesDownloaded: 300,
      totalBytes: 1_000,
    };

    const view = selectInstallProgress(client, idleBundle(), {
      hasBundle: true,
      hasLoader: false,
    });

    expect(view).toMatchObject({ mode: 'install', activeStep: InstallStepKeys.MINECRAFT });
  });

  it('keeps bundle manifest/plan checks out of the download progress card', () => {
    for (const status of [BundleSyncStatuses.FETCHING_MANIFEST, BundleSyncStatuses.PLANNING]) {
      const view = selectInstallProgress(installedClient(), bundleAt(status), {
        hasBundle: true,
        hasLoader: false,
      });
      expect(view).toBeNull();
    }
  });

  it('shows the bundle progress card once bundle files are downloading', () => {
    const progress: BundleProgressEvent = {
      slug: asClientSlug('demo'),
      status: BundleSyncStatuses.DOWNLOADING,
      processedFiles: 2,
      totalFiles: 10,
      toDownload: 8,
      toUpdate: 0,
      toDelete: 0,
      toSkip: 0,
      bytesDownloaded: 500,
      bytesTotal: 2_000,
      speedBytesPerSec: 1_000,
    };

    const view = selectInstallProgress(
      installedClient(),
      bundleAt(BundleSyncStatuses.DOWNLOADING, progress),
      { hasBundle: true, hasLoader: false },
    );

    expect(view).toMatchObject({ mode: 'bundle', activeStep: InstallStepKeys.BUNDLE });
  });

  it('keeps repair verification out of the download progress card', () => {
    const client: ClientRuntimeState = {
      status: InstallStatuses.REPAIRING,
      paused: false,
    };

    const view = selectInstallProgress(client, idleBundle(), {
      hasBundle: true,
      hasLoader: true,
    });

    expect(view).toBeNull();
  });

  it('shows the repair progress card once repair is actually downloading', () => {
    const client: ClientRuntimeState = {
      status: InstallStatuses.REPAIRING,
      paused: false,
      stage: ProgressStages.LOADER,
      stagePercent: 45,
      overallPercent: 60,
      bytesDownloaded: 900,
      totalBytes: 2_000,
      currentFile: 'libraries/loader.jar',
    };

    const view = selectInstallProgress(client, idleBundle(), {
      hasBundle: true,
      hasLoader: true,
    });

    expect(view).toMatchObject({
      mode: 'repair',
      activeStep: InstallStepKeys.LOADER,
      controls: null,
    });
    const loader = view?.steps.find((step) => step.key === InstallStepKeys.LOADER);
    expect(loader).toMatchObject({
      state: StepStates.ACTIVE,
      percent: 45,
      bytesDownloaded: 900,
      bytesTotal: 2_000,
      currentFile: 'libraries/loader.jar',
      subStage: ProgressStages.LOADER,
    });
  });
});

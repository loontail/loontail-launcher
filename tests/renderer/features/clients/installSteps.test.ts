import type { BundleRuntimeState } from '@renderer/features/bundle';
import {
  InstallStepKeys,
  StepStates,
  selectInstallProgress,
} from '@renderer/features/clients/components/install/installSteps';
import type { ClientRuntimeState } from '@renderer/features/minecraft';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import { InstallStatuses, ProgressStages } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const idleBundle = (): BundleRuntimeState => ({
  status: BundleSyncStatuses.UNKNOWN,
  installed: false,
  signatureMatches: true,
  progress: null,
});

describe('selectInstallProgress', () => {
  it('renders repair recovery with cancel-only controls while waiting for repair progress', () => {
    const client: ClientRuntimeState = {
      status: InstallStatuses.REPAIRING,
      paused: false,
    };

    const view = selectInstallProgress(client, idleBundle(), {
      hasBundle: true,
      hasLoader: true,
    });

    expect(view).toMatchObject({
      mode: 'repair',
      activeStep: InstallStepKeys.MINECRAFT,
      paused: false,
      controls: 'cancel',
    });
    const active = view?.steps.find((step) => step.key === InstallStepKeys.MINECRAFT);
    expect(active).toMatchObject({
      state: StepStates.ACTIVE,
      indeterminate: true,
      percent: 0,
    });
  });

  it('uses current repair progress instead of stale install progress', () => {
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
      controls: 'cancel',
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

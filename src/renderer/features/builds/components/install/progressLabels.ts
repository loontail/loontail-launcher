import type { InstallProgressMode, InstallStep, InstallStepKey } from './installSteps';
import { InstallStepKeys } from './installSteps';

export const STEP_TITLE_KEY: Record<InstallStepKey, string> = {
  [InstallStepKeys.RUNTIME]: 'builds.installSteps.runtime.title',
  [InstallStepKeys.MINECRAFT]: 'builds.installSteps.minecraft.title',
  [InstallStepKeys.LOADER]: 'builds.installSteps.loader.title',
  [InstallStepKeys.BUNDLE]: 'builds.installSteps.bundle.title',
};

export const HEADER_KEY_BY_MODE: Record<InstallProgressMode, string> = {
  install: 'builds.installSteps.header.install',
  repair: 'builds.installSteps.header.repair',
  bundle: 'builds.installSteps.header.bundle',
};

export const subStageLabelKey = (step: InstallStep): string | null => {
  if (!step.subStage) return null;
  if (step.key === InstallStepKeys.BUNDLE) return `builds.bundleStage.${step.subStage}`;
  return `builds.stage.${step.subStage}`;
};

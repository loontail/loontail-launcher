import type { InstallProgressMode, InstallStep, InstallStepKey } from './installSteps';
import { InstallStepKeys } from './installSteps';

export const STEP_TITLE_KEY: Record<InstallStepKey, string> = {
  [InstallStepKeys.RUNTIME]: 'clients.installSteps.runtime.title',
  [InstallStepKeys.MINECRAFT]: 'clients.installSteps.minecraft.title',
  [InstallStepKeys.LOADER]: 'clients.installSteps.loader.title',
  [InstallStepKeys.BUNDLE]: 'clients.installSteps.bundle.title',
};

export const STEP_NUMBER: Record<InstallStepKey, number> = {
  [InstallStepKeys.RUNTIME]: 1,
  [InstallStepKeys.MINECRAFT]: 2,
  [InstallStepKeys.LOADER]: 3,
  [InstallStepKeys.BUNDLE]: 4,
};

export const HEADER_KEY_BY_MODE: Record<InstallProgressMode, string> = {
  install: 'clients.installSteps.header.install',
  repair: 'clients.installSteps.header.repair',
  bundle: 'clients.installSteps.header.bundle',
};

export const subStageLabelKey = (step: InstallStep): string | null => {
  if (!step.subStage) return null;
  if (step.key === InstallStepKeys.BUNDLE) return `clients.bundleStage.${step.subStage}`;
  return `clients.stage.${step.subStage}`;
};

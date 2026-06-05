import type { ClientSlug } from '@shared/contracts/ids';
import { useTranslation } from 'react-i18next';
import { InstallStepper } from './InstallStepper';
import { ProgressBody } from './ProgressBody';
import type { InstallProgressView } from './installSteps';
import { HEADER_KEY_BY_MODE } from './progressLabels';

export type InstallProgressProps = {
  slug: ClientSlug;
  view: InstallProgressView;
};

export const InstallProgress = ({ slug, view }: InstallProgressProps) => {
  const { t } = useTranslation();
  const { steps, activeStep, paused, controls, mode } = view;
  const active = steps.find((step) => step.key === activeStep) ?? null;
  const activeIndex = active ? steps.findIndex((step) => step.key === active.key) + 1 : 0;
  const stepIndicator = active
    ? t('clients.installSteps.stepIndicator', {
        current: activeIndex,
        total: steps.length,
      })
    : '';

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="flex w-full flex-col gap-4 rounded-lg border border-edge bg-surface p-5 backdrop-blur-md"
    >
      <p className="text-microlabel font-bold uppercase tracking-[0.22em] text-glass/55">
        {t(HEADER_KEY_BY_MODE[mode])}
        {stepIndicator && <span className="ml-2 text-glass/40">- {stepIndicator}</span>}
      </p>

      <InstallStepper steps={steps} />

      {active && <ProgressBody active={active} paused={paused} controls={controls} slug={slug} />}
    </div>
  );
};

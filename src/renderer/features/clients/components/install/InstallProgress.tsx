import type { CatalogKey } from '@shared/contracts/ids';
import { useTranslation } from 'react-i18next';
import { InstallStepper } from './InstallStepper';
import { ProgressBody } from './ProgressBody';
import type { InstallProgressView } from './installSteps';
import { HEADER_KEY_BY_MODE } from './progressLabels';

export type InstallProgressProps = {
  slug: CatalogKey;
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
      className="flex w-full flex-col gap-4 rounded-md border border-edge bg-surface-1 p-5"
    >
      <p className="text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">
        {t(HEADER_KEY_BY_MODE[mode])}
        {stepIndicator && <span className="ml-2 text-text-faint">· {stepIndicator}</span>}
      </p>

      <InstallStepper steps={steps} />

      {active && <ProgressBody active={active} paused={paused} controls={controls} slug={slug} />}
    </div>
  );
};

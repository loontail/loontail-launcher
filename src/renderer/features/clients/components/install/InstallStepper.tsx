import { cn } from '@renderer/shared/lib/cn';
import { Check, Loader2, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { InstallStep } from './installSteps';
import { StepStates } from './installSteps';
import { STEP_TITLE_KEY } from './progressLabels';

const renderStepIcon = (step: InstallStep, stepNumber: number) => {
  if (step.state === StepStates.DONE) return <Check size={12} strokeWidth={3} />;
  if (step.state === StepStates.PAUSED) return <Pause size={10} />;
  if (step.state === StepStates.ACTIVE) return <Loader2 size={12} className="animate-spin" />;
  return <span>{stepNumber}</span>;
};

type StepBadgeProps = {
  step: InstallStep;
  stepNumber: number;
  isFirst: boolean;
  previousDone: boolean;
};

const StepBadge = ({ step, stepNumber, isFirst, previousDone }: StepBadgeProps) => {
  const { t } = useTranslation();
  const isActive = step.state === StepStates.ACTIVE || step.state === StepStates.PAUSED;
  const isDone = step.state === StepStates.DONE;
  const isPending = step.state === StepStates.PENDING;
  const isSkipped = step.state === StepStates.SKIPPED;
  const isPaused = step.state === StepStates.PAUSED;

  return (
    <div className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5">
      {!isFirst && (
        <div
          aria-hidden="true"
          className={cn(
            'absolute top-3 left-[calc(-50%+12px)] right-[calc(50%+12px)] h-1 -translate-y-1/2 rounded-full transition-colors',
            previousDone ? 'bg-primary/70' : 'bg-glass/15',
          )}
        />
      )}
      <div
        className={cn(
          'relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-microlabel font-bold leading-none transition-colors',
          isDone && 'bg-primary text-primary-foreground',
          isActive && !isPaused && 'bg-primary text-primary-foreground',
          isPaused && 'border border-edge-xl bg-ghost text-glass/75',
          isPending && 'border border-edge-md bg-glass/5 text-glass/40',
          isSkipped && 'border border-edge bg-glass/5 text-glass/25',
        )}
        aria-current={isActive ? 'step' : undefined}
      >
        {renderStepIcon(step, stepNumber)}
      </div>
      <span
        className={cn(
          'truncate text-center text-eyebrow font-semibold tracking-wide transition-colors',
          isActive && 'text-glass',
          isPaused && 'text-glass/75',
          isDone && 'text-glass/80',
          isPending && 'text-glass/40',
          isSkipped && 'text-glass/30',
        )}
      >
        {t(STEP_TITLE_KEY[step.key])}
      </span>
    </div>
  );
};

type InstallStepperProps = { steps: InstallStep[] };

export const InstallStepper = ({ steps }: InstallStepperProps) => (
  <div className="flex w-full items-start">
    {steps.map((step, index) => (
      <StepBadge
        key={step.key}
        step={step}
        stepNumber={index + 1}
        isFirst={index === 0}
        previousDone={index > 0 && steps[index - 1]?.state === StepStates.DONE}
      />
    ))}
  </div>
);

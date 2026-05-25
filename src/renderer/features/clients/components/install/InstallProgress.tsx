import { useCancelBundle, usePauseBundle, useResumeBundle } from '@renderer/features/bundle';
import { useCancelInstall, usePauseInstall, useResumeInstall } from '@renderer/features/minecraft';
import { cn } from '@renderer/shared/lib/cn';
import type { ClientSlug } from '@shared/contracts/ids';
import { Check, Loader2, Pause, Play, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionBtn } from './ActionBtn';
import {
  type InstallProgressMode,
  type InstallProgressView,
  type InstallStep,
  type InstallStepKey,
  InstallStepKeys,
  type ProgressControlsKind,
  StepStates,
} from './installSteps';
import { useByteSpeed } from './useByteSpeed';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${SIZE_UNITS[unit]}`;
};

const formatSpeed = (bytesPerSec: number): string =>
  bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '';

const STEP_TITLE_KEY: Record<InstallStepKey, string> = {
  [InstallStepKeys.RUNTIME]: 'clients.installSteps.runtime.title',
  [InstallStepKeys.MINECRAFT]: 'clients.installSteps.minecraft.title',
  [InstallStepKeys.LOADER]: 'clients.installSteps.loader.title',
  [InstallStepKeys.BUNDLE]: 'clients.installSteps.bundle.title',
};

const STEP_NUMBER: Record<InstallStepKey, number> = {
  [InstallStepKeys.RUNTIME]: 1,
  [InstallStepKeys.MINECRAFT]: 2,
  [InstallStepKeys.LOADER]: 3,
  [InstallStepKeys.BUNDLE]: 4,
};

// Install sub-stage labels (kit-reported) reuse the existing `clients.stage.*`
// keys; bundle sub-stage labels reuse `clients.bundleStage.*`.
const subStageLabelKey = (step: InstallStep): string | null => {
  if (!step.subStage) return null;
  if (step.key === InstallStepKeys.BUNDLE) return `clients.bundleStage.${step.subStage}`;
  return `clients.stage.${step.subStage}`;
};

const renderStepIcon = (step: InstallStep, indexInRender: number) => {
  if (step.state === StepStates.DONE) return <Check size={12} strokeWidth={3} />;
  if (step.state === StepStates.PAUSED) return <Pause size={10} />;
  if (step.state === StepStates.ACTIVE) return <Loader2 size={12} className="animate-spin" />;
  return <span>{indexInRender}</span>;
};

type StepBadgeProps = {
  step: InstallStep;
  indexInRender: number;
  isFirst: boolean;
  prevDone: boolean;
};

// One pill in the stepper. Badge stacked above the title so the connecting
// rail (top-3, between adjacent badges) never crosses the labels. The rail to
// the left of a step lights up primary when the previous step is DONE.
const StepBadge = ({ step, indexInRender, isFirst, prevDone }: StepBadgeProps) => {
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
            // Rail straddles the gap between previous badge's right edge and
            // this badge's left edge. `left: calc(-50% + 12px)` extends into
            // the previous column up to its center + 12px (= previous badge
            // right). `right: calc(50% + 12px)` ends at this column's center
            // − 12px (= this badge left).
            'absolute top-3 left-[calc(-50%+12px)] right-[calc(50%+12px)] h-1 -translate-y-1/2 rounded-full transition-colors',
            prevDone ? 'bg-primary/70' : 'bg-glass/15',
          )}
        />
      )}
      <div
        className={cn(
          'relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold leading-none transition-colors',
          isDone && 'bg-primary text-primary-foreground',
          isActive && !isPaused && 'bg-primary text-primary-foreground',
          isPaused && 'border border-edge-xl bg-ghost text-glass/75',
          isPending && 'border border-edge-md bg-glass/5 text-glass/40',
          isSkipped && 'border border-edge bg-glass/5 text-glass/25',
        )}
        aria-current={isActive ? 'step' : undefined}
      >
        {renderStepIcon(step, indexInRender)}
      </div>
      <span
        className={cn(
          'truncate text-center text-[11px] font-semibold tracking-wide transition-colors',
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

type StepperProps = { steps: InstallStep[] };

const Stepper = ({ steps }: StepperProps) => (
  <div className="flex w-full items-start">
    {steps.map((step, idx) => (
      <StepBadge
        key={step.key}
        step={step}
        indexInRender={STEP_NUMBER[step.key]}
        isFirst={idx === 0}
        prevDone={idx > 0 && steps[idx - 1]?.state === StepStates.DONE}
      />
    ))}
  </div>
);

type ControlsProps = {
  kind: ProgressControlsKind;
  paused: boolean;
  slug: ClientSlug;
};

const InstallControls = ({ slug, paused }: { slug: ClientSlug; paused: boolean }) => {
  const { t } = useTranslation();
  const pause = usePauseInstall();
  const resume = useResumeInstall();
  const cancel = useCancelInstall();
  return (
    <>
      {paused ? (
        <ActionBtn variant="ghost" onClick={() => void resume.mutateAsync(slug)}>
          <Play size={12} />
          {t('clients.resume')}
        </ActionBtn>
      ) : (
        <ActionBtn variant="ghost" onClick={() => void pause.mutateAsync(slug)}>
          <Pause size={12} />
          {t('clients.pause')}
        </ActionBtn>
      )}
      <ActionBtn variant="danger" onClick={() => void cancel.mutateAsync(slug)}>
        <X size={12} />
        {t('clients.cancel')}
      </ActionBtn>
    </>
  );
};

const BundleControls = ({ slug, paused }: { slug: ClientSlug; paused: boolean }) => {
  const { t } = useTranslation();
  const pause = usePauseBundle();
  const resume = useResumeBundle();
  const cancel = useCancelBundle();
  return (
    <>
      {paused ? (
        <ActionBtn variant="ghost" onClick={() => void resume.mutateAsync(slug)}>
          <Play size={12} />
          {t('clients.resume')}
        </ActionBtn>
      ) : (
        <ActionBtn variant="ghost" onClick={() => void pause.mutateAsync(slug)}>
          <Pause size={12} />
          {t('clients.pause')}
        </ActionBtn>
      )}
      <ActionBtn variant="danger" onClick={() => void cancel.mutateAsync(slug)}>
        <X size={12} />
        {t('clients.cancel')}
      </ActionBtn>
    </>
  );
};

const Controls = ({ kind, paused, slug }: ControlsProps) => {
  if (kind === 'install') return <InstallControls slug={slug} paused={paused} />;
  if (kind === 'bundle') return <BundleControls slug={slug} paused={paused} />;
  return null;
};

const HEADER_KEY_BY_MODE: Record<InstallProgressMode, string> = {
  install: 'clients.installSteps.header.install',
  repair: 'clients.installSteps.header.repair',
  bundle: 'clients.installSteps.header.bundle',
};

type ProgressBodyProps = {
  active: InstallStep;
  paused: boolean;
  controls: ProgressControlsKind;
  slug: ClientSlug;
};

const ProgressBody = ({ active, paused, controls, slug }: ProgressBodyProps) => {
  const { t } = useTranslation();
  const computedSpeed = useByteSpeed(
    active.bytesDownloaded,
    !paused && active.state === StepStates.ACTIVE,
  );
  const speedSource = active.speedBytesPerSec ?? computedSpeed;
  const speedText = paused ? '' : formatSpeed(speedSource);
  const showBytes = Boolean(active.bytesTotal && active.bytesTotal > 0);
  const indeterminate = Boolean(active.indeterminate) && !paused;
  const subStageKey = subStageLabelKey(active);
  const subStageLabel = subStageKey ? t(subStageKey, { defaultValue: '' }) : '';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-glass">
          {paused && (
            <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-glass/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-glass/70">
              <Pause size={9} />
              {t('clients.paused')}
            </span>
          )}
          {subStageLabel || t(STEP_TITLE_KEY[active.key])}
        </p>
        {!indeterminate && (
          <p className="shrink-0 text-right text-2xl font-bold leading-none tabular-nums text-glass">
            {Math.round(active.percent)}
            <span className="text-[14px] font-semibold text-glass/55">%</span>
          </p>
        )}
      </div>

      <div className="relative h-2 w-full overflow-hidden rounded-full bg-glass/15">
        {indeterminate ? (
          <div
            className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary/70 animate-[install-indeterminate_1.4s_ease-in-out_infinite]"
            aria-hidden="true"
          />
        ) : (
          <div
            className={cn(
              'h-full w-full transition-transform duration-150',
              paused ? 'bg-glass/40' : 'bg-primary',
            )}
            style={{
              transform: `translateX(-${Math.max(0, Math.min(100, 100 - active.percent))}%)`,
            }}
          />
        )}
      </div>

      <div className="flex w-full items-center justify-between gap-3">
        {/*
          Truncate from the START: the filename at the path's tail is the
          informative part — the drive prefix is noise. CSS lacks a native
          "ellipsis on the left", so `dir="rtl"` flips the inline progression
          so overflow eats the leading characters; `text-left` keeps short
          paths anchored to the physical left edge instead of floating to
          the right; `<bdi>` keeps the latin path's character order LTR.
        */}
        <p
          dir="rtl"
          className="min-w-0 flex-1 truncate text-left text-[11px] text-glass/60"
          title={active.currentFile ?? ''}
        >
          <bdi>{active.currentFile || ' '}</bdi>
        </p>
        <div className="flex shrink-0 items-center gap-2 tabular-nums text-[11px] text-glass/55">
          {speedText && <span>{speedText}</span>}
          {showBytes && speedText && <span className="text-glass/25">·</span>}
          {showBytes && (
            <span>
              {formatBytes(active.bytesDownloaded ?? 0)} / {formatBytes(active.bytesTotal ?? 0)}
            </span>
          )}
        </div>
      </div>

      {controls && (
        <div className="flex gap-2">
          <Controls kind={controls} paused={paused} slug={slug} />
        </div>
      )}
    </div>
  );
};

export type InstallProgressProps = {
  slug: ClientSlug;
  view: InstallProgressView;
};

export const InstallProgress = ({ slug, view }: InstallProgressProps) => {
  const { t } = useTranslation();
  const { steps, activeStep, paused, controls, mode } = view;
  const active = steps.find((s) => s.key === activeStep) ?? null;
  const activeIndex = active ? steps.findIndex((s) => s.key === active.key) + 1 : 0;
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
      className="flex w-full flex-col gap-4 rounded-2xl border border-edge bg-surface p-5 backdrop-blur-md"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-glass/55">
        {t(HEADER_KEY_BY_MODE[mode])}
        {stepIndicator && <span className="ml-2 text-glass/40">· {stepIndicator}</span>}
      </p>

      <Stepper steps={steps} />

      {active && <ProgressBody active={active} paused={paused} controls={controls} slug={slug} />}
    </div>
  );
};

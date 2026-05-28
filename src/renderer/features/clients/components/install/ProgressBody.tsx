import { cn } from '@renderer/shared/lib/cn';
import type { ClientSlug } from '@shared/contracts/ids';
import { Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ProgressControls } from './ProgressControls';
import type { InstallStep, ProgressControlsKind } from './installSteps';
import { StepStates } from './installSteps';
import { formatBytes, formatSpeed } from './progressFormat';
import { STEP_TITLE_KEY, subStageLabelKey } from './progressLabels';
import { useByteSpeed } from './useByteSpeed';

type ProgressBodyProps = {
  active: InstallStep;
  paused: boolean;
  controls: ProgressControlsKind;
  slug: ClientSlug;
};

export const ProgressBody = ({ active, paused, controls, slug }: ProgressBodyProps) => {
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
            <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-glass/15 px-2 py-0.5 text-microlabel font-bold uppercase tracking-wide text-glass/70">
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
        <p
          dir="rtl"
          className="min-w-0 flex-1 truncate text-left text-eyebrow text-glass/60"
          title={active.currentFile ?? ''}
        >
          <bdi>{active.currentFile || ' '}</bdi>
        </p>
        <div className="flex shrink-0 items-center gap-2 tabular-nums text-eyebrow text-glass/55">
          {speedText && <span>{speedText}</span>}
          {showBytes && speedText && <span className="text-glass/25">/</span>}
          {showBytes && (
            <span>
              {formatBytes(active.bytesDownloaded ?? 0)} / {formatBytes(active.bytesTotal ?? 0)}
            </span>
          )}
        </div>
      </div>

      {controls && (
        <div className="flex gap-2">
          <ProgressControls kind={controls} paused={paused} slug={slug} />
        </div>
      )}
    </div>
  );
};

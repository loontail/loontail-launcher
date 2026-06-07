import { cn } from '@renderer/shared/lib/cn';
import type { ClientSlug } from '@shared/contracts/ids';
import { Pause } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProgressControls } from './ProgressControls';
import type { InstallStep, ProgressControlsKind } from './installSteps';
import { StepStates } from './installSteps';
import { computeEtaSeconds, formatBytes, formatEta, formatSpeed } from './progressFormat';
import { STEP_TITLE_KEY, subStageLabelKey } from './progressLabels';
import { useByteSpeed, useMonotonicPercent } from './useByteSpeed';

type ProgressBodyProps = {
  active: InstallStep;
  paused: boolean;
  controls: ProgressControlsKind;
  slug: ClientSlug;
};

// A transfer is "stalled" when bytes haven't advanced for a few seconds while
// it should be actively downloading — surfaced as a hint so a slow network
// doesn't read as a frozen UI.
const STALL_MS = 6000;

const useStalled = (bytes: number | undefined, active: boolean): boolean => {
  const lastBytesRef = useRef<number | null>(null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!active || bytes === undefined) {
      lastBytesRef.current = null;
      setStalled(false);
      return;
    }
    if (bytes !== lastBytesRef.current) {
      lastBytesRef.current = bytes;
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(timer);
  }, [bytes, active]);

  return stalled;
};

export const ProgressBody = ({ active, paused, controls, slug }: ProgressBodyProps) => {
  const { t } = useTranslation();
  const isDownloading = !paused && active.state === StepStates.ACTIVE;
  const computedSpeed = useByteSpeed(active.bytesDownloaded, isDownloading);
  const speedSource = active.speedBytesPerSec ?? computedSpeed;
  const speedText = paused ? '' : formatSpeed(speedSource);
  const showBytes = Boolean(active.bytesTotal && active.bytesTotal > 0);
  const indeterminate = Boolean(active.indeterminate) && !paused;
  const stalled = useStalled(active.bytesDownloaded, isDownloading) && !indeterminate;

  // Never let the displayed bar retreat; reset the high-water mark per step.
  const percent = useMonotonicPercent(active.percent, active.key);
  const remaining = Math.max(0, (active.bytesTotal ?? 0) - (active.bytesDownloaded ?? 0));
  const etaText =
    paused || indeterminate || !showBytes
      ? ''
      : formatEta(computeEtaSeconds(remaining, speedSource));

  const subStageKey = subStageLabelKey(active);
  const subStageLabel = subStageKey ? t(subStageKey, { defaultValue: '' }) : '';
  const phaseLabel = subStageLabel || t(STEP_TITLE_KEY[active.key]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative h-9 w-full overflow-hidden rounded-md bg-surface-2">
        {indeterminate ? (
          // Reduced motion collapses the sliding stripe to a frozen partial bar,
          // which reads as "stuck". So under motion-reduce show a steady, subtle
          // full-width fill (clearly "working, indeterminate"); the sliding 1/3
          // stripe is motion-safe only.
          <div
            className="absolute inset-y-0 left-0 motion-reduce:w-full motion-reduce:bg-glass/20 motion-safe:w-1/3 motion-safe:bg-glass/45 motion-safe:animate-[install-indeterminate_1.4s_ease-in-out_infinite]"
            aria-hidden="true"
          />
        ) : (
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-[width] duration-300 ease-standard',
              paused ? 'bg-glass/35' : 'bg-cta',
            )}
            style={{ width: `${percent}%` }}
            aria-hidden="true"
          />
        )}

        <div className="relative z-10 flex h-full items-center justify-between gap-3 px-3">
          <span
            className={cn(
              'inline-flex min-w-0 items-center gap-1.5 truncate text-body-med',
              paused || indeterminate ? 'text-glass' : 'mix-blend-difference text-glass',
            )}
          >
            {paused && <Pause size={12} />}
            {paused ? t('clients.paused') : phaseLabel}
          </span>
          {!indeterminate && (
            <span
              className={cn(
                'shrink-0 text-body-med tabular-nums',
                paused ? 'text-glass' : 'mix-blend-difference text-glass',
              )}
            >
              {Math.round(percent)}%
            </span>
          )}
        </div>
      </div>

      <div className="flex w-full items-center justify-between gap-3">
        <p
          dir="rtl"
          className="min-w-0 flex-1 truncate text-left text-eyebrow text-text-mute"
          title={active.currentFile ?? ''}
        >
          <bdi>{active.currentFile || ' '}</bdi>
        </p>
        <div className="flex shrink-0 items-center gap-2 text-eyebrow tabular-nums text-text-mute">
          {showBytes && (
            <span>
              {formatBytes(active.bytesDownloaded ?? 0)} / {formatBytes(active.bytesTotal ?? 0)}
            </span>
          )}
          {speedText && showBytes && <span className="text-text-faint">·</span>}
          {speedText && <span>{speedText}</span>}
          {etaText && <span className="text-text-faint">·</span>}
          {etaText && <span>{etaText}</span>}
        </div>
      </div>

      {stalled && <p className="text-eyebrow text-text-mute">{t('clients.progressStalled')}</p>}

      {controls && (
        <div className="flex gap-2">
          <ProgressControls kind={controls} paused={paused} slug={slug} />
        </div>
      )}
    </div>
  );
};

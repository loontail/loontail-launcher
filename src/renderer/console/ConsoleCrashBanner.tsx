import { type ConsoleProcessState, ConsoleStatuses } from '@shared/contracts/console';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ConsoleCrashBannerProps = {
  state: ConsoleProcessState;
  statusLabel: string;
};

export const ConsoleCrashBanner = ({ state, statusLabel }: ConsoleCrashBannerProps) => {
  const { t } = useTranslation();
  const isCrashed =
    state.status === ConsoleStatuses.CRASHED || state.status === ConsoleStatuses.ERROR;
  const exitCode = state.exitCode ?? null;

  if (!isCrashed) return null;

  return (
    <output className="flex flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-caption text-destructive">
      <AlertTriangle size={14} aria-hidden="true" />
      <strong className="font-semibold">{statusLabel}</strong>
      <span className="text-glass/70">{t('console.crashHint')}</span>
      {exitCode != null && (
        <span className="font-mono text-glass/65">{t('console.exitCodeLabel', { exitCode })}</span>
      )}
      {state.message && (
        <span className="truncate text-glass/65" title={state.message}>
          {state.message}
        </span>
      )}
    </output>
  );
};

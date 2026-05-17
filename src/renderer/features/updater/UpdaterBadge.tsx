import { cn } from '@renderer/shared/lib/cn';
import { IPC_CHANNELS } from '@shared/ipc';
import { ArrowDownToLine, Loader2, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdaterStatus } from './store';

const handleRestart = () => {
  void window.api.invoke(IPC_CHANNELS.updaterInstall, undefined);
};

export const UpdaterBadge = () => {
  const { t } = useTranslation();
  const status = useUpdaterStatus();
  if (!status) return null;
  switch (status.state) {
    case 'available':
      return (
        <Badge tone="info" icon={<ArrowDownToLine className="size-3" />}>
          {t('updater.badge.available', { version: status.version })}
        </Badge>
      );
    case 'downloading':
      return (
        <Badge tone="info" icon={<Loader2 className="size-3 animate-spin" />}>
          {t('updater.badge.downloading', { percent: Math.round(status.percent) })}
        </Badge>
      );
    case 'ready':
      return (
        <Badge
          tone="success"
          icon={<RotateCw className="size-3" />}
          onClick={handleRestart}
          title={t('updater.badge.readyTitle', { version: status.version })}
        >
          {t('updater.badge.ready')}
        </Badge>
      );
    default:
      return null;
  }
};

type BadgeTone = 'info' | 'success';

const TONE_CLASSES: Record<BadgeTone, string> = {
  info: 'text-glass/70 ring-glass/20 hover:text-glass hover:ring-glass/30',
  success:
    'text-success/90 ring-success/40 bg-success/10 hover:bg-success/20 hover:text-success hover:ring-success/60',
};

type BadgeProps = {
  tone: BadgeTone;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
};

const Badge = ({ tone, icon, children, onClick, title }: BadgeProps) => {
  const className = cn(
    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 transition-colors',
    TONE_CLASSES[tone],
    onClick && 'cursor-pointer',
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={className}>
        {icon}
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={className}>
      {icon}
      {children}
    </span>
  );
};

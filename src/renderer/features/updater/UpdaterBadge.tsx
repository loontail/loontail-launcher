import { cn } from '@renderer/shared/lib/cn';
import { UpdaterStates } from '@shared/contracts/updater';
import { ArrowDownToLine, Loader2, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { triggerInstall } from './api';
import { useUpdaterStatus } from './store';

const handleRestart = () => {
  triggerInstall();
};

export const UpdaterBadge = () => {
  const { t } = useTranslation();
  const status = useUpdaterStatus();
  if (!status) return null;
  switch (status.state) {
    case UpdaterStates.AVAILABLE:
      return (
        <Badge icon={<ArrowDownToLine className="size-3" />}>
          {t('updater.badge.available', { version: status.version })}
        </Badge>
      );
    case UpdaterStates.DOWNLOADING:
      return (
        <Badge icon={<Loader2 className="size-3 animate-spin" />}>
          {t('updater.badge.downloading', { percent: Math.round(status.percent) })}
        </Badge>
      );
    case UpdaterStates.READY:
      return (
        <Badge
          ready
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

type BadgeProps = {
  icon: React.ReactNode;
  children: React.ReactNode;
  ready?: boolean;
  onClick?: () => void;
  title?: string;
};

// Persistent, non-dismissing title-bar marker. Monochrome: the "ready" state
// reads brighter (a solid neutral dot + raised text), never by hue.
const Badge = ({ icon, children, ready, onClick, title }: BadgeProps) => {
  const className = cn(
    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-microlabel font-bold uppercase tracking-wider ring-1 transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/60',
    ready
      ? 'bg-glass/10 text-glass ring-glass/35 hover:bg-glass/15 hover:ring-glass/50'
      : 'text-glass/70 ring-glass/20 hover:text-glass hover:ring-glass/30',
  );
  const dot = (
    <span
      aria-hidden="true"
      className={cn('size-1.5 rounded-full', ready ? 'bg-glass' : 'bg-glass/50')}
    />
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cn(className, 'cursor-pointer')}
      >
        {dot}
        {icon}
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={className}>
      {dot}
      {icon}
      {children}
    </span>
  );
};

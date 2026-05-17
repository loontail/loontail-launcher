import { cn } from '@renderer/shared/lib/cn';
import { ArrowDownToLine, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdaterStatus } from './store';

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
        <Badge tone="success" icon={<Check className="size-3" />}>
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
  success: 'text-success/80 ring-success/30 hover:text-success hover:ring-success/40',
};

type BadgeProps = {
  tone: BadgeTone;
  icon: React.ReactNode;
  children: React.ReactNode;
};

const Badge = ({ tone, icon, children }: BadgeProps) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 transition-colors',
      TONE_CLASSES[tone],
    )}
  >
    {icon}
    {children}
  </span>
);

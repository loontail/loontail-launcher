import { cn } from '@renderer/shared/lib/cn';
import type { CatalogItem } from '@shared/contracts/catalog';
import { useTranslation } from 'react-i18next';
import { STATUS_DOT_CLASSES, STATUS_TEXT_CLASSES } from './statusTone';
import { useBuildStatus } from './useBuildStatus';

type BuildStatusMarkerProps = {
  item: CatalogItem;
  className?: string;
};

// Compact, background-less status used on grid tiles: a coloured dot plus a tiny
// label. Deliberately not a pill — the tiles read calmer without bordered chips.
export const BuildStatusMarker = ({ item, className }: BuildStatusMarkerProps) => {
  const { t } = useTranslation();
  const { labelKey, tone } = useBuildStatus(item);

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT_CLASSES[tone])} />
      <span
        className={cn(
          'truncate text-microlabel font-semibold uppercase tracking-wide',
          STATUS_TEXT_CLASSES[tone],
        )}
      >
        {t(labelKey)}
      </span>
    </span>
  );
};

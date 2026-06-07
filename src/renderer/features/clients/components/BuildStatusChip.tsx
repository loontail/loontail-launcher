import { cn } from '@renderer/shared/lib/cn';
import type { CatalogItem } from '@shared/contracts/catalog';
import {
  ArrowUpCircle,
  Check,
  Download,
  Loader2,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BuildStatusGlyph } from './buildStatus';
import { useBuildStatus } from './useBuildStatus';

type BuildStatusChipProps = {
  item: CatalogItem;
  className?: string;
};

const ICON_BY_GLYPH: Record<BuildStatusGlyph, LucideIcon> = {
  installed: Check,
  update: ArrowUpCircle,
  download: Download,
  busy: Loader2,
  error: TriangleAlert,
};

// Brightness/weight convey state — never hue. Installed reads brightest, an
// available update slightly dimmer, idle/download quiet, and error sits at a
// bright weight so it cannot be missed in a monochrome grid.
const TEXT_BY_GLYPH: Record<BuildStatusGlyph, string> = {
  installed: 'text-text-hi',
  update: 'text-text',
  download: 'text-text-mute',
  busy: 'text-text-mute',
  error: 'text-text-hi font-bold',
};

// Tiny monochrome status indicator for build cards: a lucide glyph plus a short
// label. No color and no pill chrome — the grid stays calm and state is read
// from icon + text + brightness.
export const BuildStatusChip = ({ item, className }: BuildStatusChipProps) => {
  const { t } = useTranslation();
  const { labelKey, glyph } = useBuildStatus(item);
  const Icon = ICON_BY_GLYPH[glyph];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-microlabel font-semibold uppercase tracking-wide',
        TEXT_BY_GLYPH[glyph],
        className,
      )}
    >
      <Icon className={cn('size-3 shrink-0', glyph === 'busy' && 'motion-safe:animate-spin')} />
      <span className="truncate">{t(labelKey)}</span>
    </span>
  );
};

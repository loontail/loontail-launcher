import { cn } from '@renderer/shared/lib/cn';
import { Badge } from '@renderer/shared/ui/Badge';
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

const ICON_BY_GLYPH: Record<BuildStatusGlyph, LucideIcon> = {
  installed: Check,
  update: ArrowUpCircle,
  download: Download,
  busy: Loader2,
  error: TriangleAlert,
};

export const BuildStatusBadge = ({
  item,
  className,
}: {
  item: CatalogItem;
  className?: string;
}) => {
  const { t } = useTranslation();
  const { labelKey, glyph } = useBuildStatus(item);
  const Icon = ICON_BY_GLYPH[glyph];
  return (
    <Badge variant="solid" className={className}>
      <Icon
        className={cn('size-3.5', glyph === 'busy' && 'motion-safe:animate-spin')}
        strokeWidth={2.5}
        aria-hidden
      />
      {t(labelKey)}
    </Badge>
  );
};

import { primaryLoader } from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import type { CatalogItem } from '@shared/contracts/catalog';
import { useTranslation } from 'react-i18next';
import { BuildMedia } from './BuildMedia';
import { BuildStatusChip } from './BuildStatusChip';
import type { BuildViewMode } from './viewMode';

type BuildTileProps = {
  item: CatalogItem;
  onOpen: (item: CatalogItem) => void;
  variant?: BuildViewMode;
};

const MetaRow = ({ item, className }: { item: CatalogItem; className?: string }) => {
  const { t } = useTranslation();
  const loader = primaryLoader(item);
  const { minecraftVersion } = item.spec;
  return (
    <div className={cn('flex items-center gap-1.5 text-caption text-text-mute', className)}>
      {minecraftVersion && (
        <span className="tabular-nums">
          {t('clients.versionChip.short', { version: minecraftVersion })}
        </span>
      )}
      {minecraftVersion && <span className="opacity-50">·</span>}
      <span className="truncate">{t(`clientSettings.loader.${loader}`)}</span>
    </div>
  );
};

const GridCard = ({ item, onOpen }: { item: CatalogItem; onOpen: (item: CatalogItem) => void }) => {
  const { t } = useTranslation();
  const { title } = item.presentation;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={t('clients.openDetails', { name: title })}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-edge bg-surface-1 text-left transition-all duration-150 ease-standard hover:border-edge-lg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50 motion-safe:hover:scale-[1.02] active:scale-[0.99]"
    >
      <div className="relative aspect-video overflow-hidden bg-chip-dark">
        <BuildMedia
          item={item}
          slot="poster"
          fallback="visual"
          className="absolute inset-0 size-full object-cover transition-transform duration-300 ease-standard motion-safe:group-hover:scale-[1.04]"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1 p-3">
        <span className="truncate text-body-med text-glass">{title}</span>
        <div className="flex items-center justify-between gap-2">
          <MetaRow item={item} className="min-w-0" />
          <BuildStatusChip item={item} className="shrink-0" />
        </div>
      </div>
    </button>
  );
};

const ListRow = ({ item, onOpen }: { item: CatalogItem; onOpen: (item: CatalogItem) => void }) => {
  const { t } = useTranslation();
  const { title } = item.presentation;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={t('clients.openDetails', { name: title })}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-edge bg-surface-1 px-3 py-2.5 text-left transition-all duration-150 ease-standard hover:border-edge-lg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50 active:scale-[0.99]"
    >
      <div className="relative aspect-video h-11 shrink-0 overflow-hidden rounded-md bg-chip-dark">
        <BuildMedia
          item={item}
          slot="poster"
          fallback="visual"
          className="absolute inset-0 size-full object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-med text-glass">{title}</span>
        <MetaRow item={item} />
      </div>
      <BuildStatusChip item={item} className="shrink-0" />
    </button>
  );
};

// One build in the catalog. The grid variant is a poster card; the list variant
// is a compact row. Both open the routed detail page on click.
export const BuildTile = ({ item, onOpen, variant = 'grid' }: BuildTileProps) =>
  variant === 'list' ? (
    <ListRow item={item} onOpen={onOpen} />
  ) : (
    <GridCard item={item} onOpen={onOpen} />
  );

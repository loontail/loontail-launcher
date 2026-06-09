import { primaryLoader } from '@renderer/features/catalog';
import type { CatalogItem } from '@shared/contracts/catalog';
import { useTranslation } from 'react-i18next';
import { BuildIcon } from './BuildIcon';
import { BuildMedia } from './BuildMedia';
import { BuildStatusBadge } from './BuildStatusBadge';

type BuildCardProps = {
  item: CatalogItem;
  onOpen: (item: CatalogItem) => void;
  variant?: 'grid' | 'list';
};

// One build in the catalog. Grid = an image-forward poster (key-art / seeded
// screenshot) with the install status over the art, and an icon + title + one
// meta line below. List = a dense row of the same parts. Color comes only from
// the build's own art; the chrome stays monochrome.
export const BuildCard = ({ item, onOpen, variant = 'grid' }: BuildCardProps) => {
  const { t } = useTranslation();
  const loader = primaryLoader(item);
  const { minecraftVersion } = item.spec;
  const { title } = item.presentation;
  const meta = [
    minecraftVersion && t('clients.versionChip.short', { version: minecraftVersion }),
    t(`clientSettings.loader.${loader}`),
  ]
    .filter(Boolean)
    .join(' · ');

  const open = () => onOpen(item);
  const ariaLabel = t('clients.openDetails', { name: title });

  if (variant === 'list') {
    return (
      <button
        type="button"
        data-build-card
        onClick={open}
        aria-label={ariaLabel}
        className="group flex w-full items-center gap-3.5 rounded-lg border border-edge bg-surface-1 p-2.5 pr-3.5 text-left transition-colors duration-150 ease-standard hover:border-edge-lg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <BuildIcon item={item} className="size-12 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-med text-text-hi">{title}</div>
          <div className="truncate text-caption tabular-nums text-text-mute">{meta}</div>
        </div>
        <BuildStatusBadge item={item} />
      </button>
    );
  }

  return (
    <button
      type="button"
      data-build-card
      onClick={open}
      aria-label={ariaLabel}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-edge bg-surface-1 text-left transition-all duration-200 ease-standard hover:border-edge-lg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-safe:hover:-translate-y-0.5"
    >
      <div className="relative aspect-video overflow-hidden">
        <BuildMedia
          item={item}
          slot="background"
          fallback="visual"
          className="absolute inset-0 size-full object-cover transition-transform duration-300 ease-standard motion-safe:group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-linear-to-t from-surface-1/90 via-surface-1/10 to-transparent" />
        <div className="absolute inset-x-0 top-0 flex justify-end p-2.5">
          <BuildStatusBadge item={item} />
        </div>
      </div>
      <div className="flex items-center gap-2.5 p-3">
        <BuildIcon item={item} className="size-9 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-med text-text-hi">{title}</div>
          <div className="truncate text-caption tabular-nums text-text-mute">{meta}</div>
        </div>
      </div>
    </button>
  );
};

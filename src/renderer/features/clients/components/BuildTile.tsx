import { primaryLoader } from '@renderer/features/catalog';
import type { CatalogItem } from '@shared/contracts/catalog';
import { useTranslation } from 'react-i18next';
import { BuildIcon } from './BuildIcon';
import { BuildStatusMarker } from './BuildStatusMarker';

type BuildTileProps = {
  item: CatalogItem;
  onOpen: (item: CatalogItem) => void;
};

// Compact horizontal client card for the home list: poster thumbnail, title and a
// single quiet metadata line (MC version · loader), with the install status as a
// small dot+label on the right. Opens the detail modal on click.
export const BuildTile = ({ item, onOpen }: BuildTileProps) => {
  const { t } = useTranslation();
  const loader = primaryLoader(item);
  const { minecraftVersion } = item.spec;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={t('clients.openDetails', { name: item.presentation.title })}
      className="group flex w-full cursor-pointer items-center gap-3.5 rounded-lg border border-edge bg-surface px-3.5 py-3 text-left shadow-sm transition-all duration-150 hover:border-edge-lg hover:bg-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
    >
      <BuildIcon item={item} className="size-12 shrink-0 rounded-md" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-semibold leading-tight text-glass">
          {item.presentation.title}
        </span>
        <div className="flex items-center gap-1.5 text-eyebrow text-glass/45">
          {minecraftVersion && (
            <span className="tabular-nums">
              {t('clients.versionChip.short', { version: minecraftVersion })}
            </span>
          )}
          {minecraftVersion && <span className="opacity-50">·</span>}
          <span className="truncate">{t(`clientSettings.loader.${loader}`)}</span>
        </div>
      </div>

      <BuildStatusMarker item={item} className="max-w-28 shrink-0" />
    </button>
  );
};

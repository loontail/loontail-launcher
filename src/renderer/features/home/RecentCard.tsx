import { primaryLoader } from '@renderer/features/catalog';
import { BuildMedia } from '@renderer/features/clients';
import { useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import type { CatalogItem } from '@shared/contracts/catalog';
import { useTranslation } from 'react-i18next';

type RecentCardProps = {
  item: CatalogItem;
};

// Compact card for the "Recently played" strip: 16:9 key art over a title and a
// quiet meta line. The whole card opens the routed detail page.
export const RecentCard = ({ item }: RecentCardProps) => {
  const { t } = useTranslation();
  const push = useNavigationStore((s) => s.push);
  const loader = primaryLoader(item);
  const { minecraftVersion } = item.spec;
  const { title } = item.presentation;

  return (
    <button
      type="button"
      onClick={() => push({ name: 'build', key: item.key })}
      aria-label={t('clients.openDetails', { name: title })}
      className="group flex cursor-pointer flex-col gap-2 rounded-lg border border-edge bg-surface-1 p-2 text-left shadow-sm transition-all duration-150 ease-standard hover:border-edge-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50 motion-safe:hover:scale-[1.02] active:scale-[0.99]"
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-chip-dark">
        <BuildMedia
          item={item}
          slot="poster"
          fallback="visual"
          className="absolute inset-0 size-full object-cover transition-transform duration-300 ease-standard motion-safe:group-hover:scale-[1.04]"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-1 pb-1">
        <span className="truncate text-body-med text-glass">{title}</span>
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
    </button>
  );
};

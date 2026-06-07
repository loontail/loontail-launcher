import { primaryLoader } from '@renderer/features/catalog';
import { BuildMedia, PlayButton } from '@renderer/features/clients';
import { useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import type { CatalogItem } from '@shared/contracts/catalog';
import { useTranslation } from 'react-i18next';

type ContinueCardProps = {
  item: CatalogItem;
};

// Home's "Continue" hero: the single most-recently-played build rendered as a
// full-width key-art card. The art + title open the routed detail page; the
// Play CTA stays a sibling (not nested) so it owns its own click.
export const ContinueCard = ({ item }: ContinueCardProps) => {
  const { t } = useTranslation();
  const push = useNavigationStore((s) => s.push);
  const loader = primaryLoader(item);
  const { minecraftVersion } = item.spec;
  const { title } = item.presentation;

  const open = (): void => push({ name: 'build', key: item.key });

  return (
    <section className="group relative isolate h-52 overflow-hidden rounded-lg border border-edge bg-surface-1 shadow-sm">
      <button
        type="button"
        onClick={open}
        aria-label={t('clients.openDetails', { name: title })}
        className="absolute inset-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-glass/50"
      >
        <BuildMedia
          item={item}
          slot="background"
          fallback="visual"
          className="absolute inset-0 size-full object-cover transition-transform duration-300 ease-standard motion-safe:group-hover:scale-[1.03]"
        />
        <div className="scrim-hero absolute inset-0" />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-6">
        <span className="text-microlabel font-bold uppercase tracking-eyebrow text-glass/55">
          {t('home.continue')}
        </span>
        <h2 className="text-display font-black leading-tight text-glass drop-shadow-[0_4px_16px_var(--color-glow-overlay-md)]">
          {title}
        </h2>
        <div className="flex items-center gap-1.5 text-caption text-glass/60">
          {minecraftVersion && (
            <span className="tabular-nums">
              {t('clients.versionChip.short', { version: minecraftVersion })}
            </span>
          )}
          {minecraftVersion && <span className="opacity-50">·</span>}
          <span className="truncate">{t(`clientSettings.loader.${loader}`)}</span>
        </div>
        <div className="pointer-events-auto mt-1 flex flex-wrap items-start gap-3">
          <PlayButton item={item} />
        </div>
      </div>
    </section>
  );
};

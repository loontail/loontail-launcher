import { loaderVersionFor, primaryLoader } from '@renderer/features/catalog';
import { type CatalogItem, isOfficial } from '@shared/contracts/catalog';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BuildChip } from './BuildChip';
import { BuildMedia } from './BuildMedia';
import { PlayButton } from './PlayButton';

type BuildHeroProps = {
  item: CatalogItem;
  onBack: () => void;
};

// The detail page's main hero: a back affordance, the build title/logo, compact
// metadata chips, a short description and the launch row (the white Play CTA) —
// laid over the page's fixed full-bleed backdrop. Settings, media and servers
// live in the tabbed body below, so the hero stays focused on identity + launch.
export const BuildHero = ({ item, onBack }: BuildHeroProps) => {
  const { t } = useTranslation();

  const hasTitleImage = isOfficial(item) && Boolean(item.raw.titleImage);
  const loader = primaryLoader(item);
  const loaderVersion = loaderVersionFor(item);
  const { minecraftVersion } = item.spec;
  const { title, shortDescription } = item.presentation;
  const keywords = isOfficial(item) ? item.raw.keywords : [];
  const hasMeta = Boolean(minecraftVersion) || keywords.length > 0;

  return (
    <section className="flex flex-col gap-6 px-12 pb-12 pt-8">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('clients.back')}
        className="group flex w-fit items-center gap-2 rounded-full bg-overlay/40 py-1.5 pl-2 pr-3.5 text-caption font-semibold text-glass/70 ring-1 ring-edge backdrop-blur-md transition-all duration-150 ease-standard hover:bg-overlay/60 hover:text-glass hover:ring-edge-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
      >
        <ArrowLeft className="size-4 transition-transform duration-150 group-hover:-translate-x-0.5" />
        {t('clients.back')}
      </button>

      <div className="flex max-w-140 flex-col gap-5">
        {hasTitleImage ? (
          <div className="flex h-22 max-w-102.5 items-start">
            <BuildMedia
              item={item}
              slot="titleImage"
              fallback="none"
              className="h-full w-auto object-contain object-left drop-shadow-[0_8px_24px_var(--color-glow-overlay-lg)]"
            />
          </div>
        ) : (
          <h1 className="text-display font-black leading-[1.05] tracking-tight drop-shadow-[0_4px_16px_var(--color-glow-overlay-md)]">
            {title}
          </h1>
        )}

        {hasMeta && (
          <div className="flex flex-wrap gap-1.5">
            {minecraftVersion && (
              <BuildChip variant="version">
                {t('clients.versionChip.full', { version: minecraftVersion })}
              </BuildChip>
            )}
            {isOfficial(item) ? (
              keywords.map((keyword) => (
                <BuildChip key={keyword.id} variant="keyword">
                  {keyword.title}
                </BuildChip>
              ))
            ) : (
              <BuildChip variant="loader">
                {t(`clientSettings.loader.${loader}`)}
                {loaderVersion ? ` ${loaderVersion}` : ''}
              </BuildChip>
            )}
          </div>
        )}

        {shortDescription && (
          <p className="max-w-115 text-body leading-relaxed text-text-mute drop-shadow">
            {shortDescription}
          </p>
        )}
      </div>

      {/* Launch row sits outside the 560-wide column so the install progress
          stepper renders at its natural width. */}
      <div className="flex max-w-180 flex-wrap items-start gap-3">
        <PlayButton item={item} />
      </div>
    </section>
  );
};

import { loaderVersionFor, primaryLoader } from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import { Badge } from '@renderer/shared/ui/Badge';
import { SectionHeading } from '@renderer/shared/ui/SectionHeading';
import { type CatalogItem, isOfficial } from '@shared/contracts/catalog';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildAbout } from './BuildAbout';
import { BuildScreenshot, buildScreenshotCount } from './BuildMedia';

const PREVIEW_COUNT = 4;

const StatTile = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="rounded-lg border border-edge-md bg-surface-2 p-4">
    <div className="text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">
      {label}
    </div>
    <div className="mt-1.5 truncate text-h1 font-bold tabular-nums text-text-hi">{value}</div>
  </div>
);

type BuildOverviewProps = {
  item: CatalogItem;
  onViewScreenshots: () => void;
};

export const BuildOverview = ({ item, onViewScreenshots }: BuildOverviewProps) => {
  const { t } = useTranslation();
  const loader = primaryLoader(item);
  const loaderVersion = loaderVersionFor(item);
  const { minecraftVersion } = item.spec;
  const { description, shortDescription, servers } = item.presentation;
  const keywords = isOfficial(item) ? item.raw.keywords : [];
  const screenshots = buildScreenshotCount(item);
  const loaderLabel = `${t(`buildSettings.loader.${loader}`)}${loaderVersion ? ` ${loaderVersion}` : ''}`;

  const previews = Array.from(
    { length: Math.min(PREVIEW_COUNT, screenshots) },
    (_, index) => index,
  );

  let aboutBody: ReactNode;
  if (description) {
    aboutBody = <BuildAbout item={item} />;
  } else if (shortDescription) {
    aboutBody = <p className="text-body leading-relaxed text-text">{shortDescription}</p>;
  } else {
    aboutBody = <p className="text-body text-text-mute">{t('builds.noAbout')}</p>;
  }

  return (
    <div className="flex flex-col gap-8 pt-7">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t('builds.stat.minecraft')} value={minecraftVersion} />
        <StatTile label={t('builds.stat.loader')} value={loaderLabel} />
        <StatTile label={t('builds.stat.servers')} value={servers.length} />
        <StatTile label={t('builds.stat.screenshots')} value={screenshots} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_minmax(0,42%)]">
        <section className="min-w-0">
          <SectionHeading>{t('builds.about')}</SectionHeading>
          {aboutBody}
          {keywords.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {keywords.map((keyword) => (
                <Badge key={keyword.id} variant="outline">
                  {keyword.title}
                </Badge>
              ))}
            </div>
          )}
        </section>

        {screenshots > 0 && (
          <section>
            <SectionHeading
              aside={
                <button
                  type="button"
                  onClick={onViewScreenshots}
                  className="inline-flex items-center gap-0.5 text-caption font-semibold text-text-mute transition-colors hover:text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {t('builds.viewAll')}
                  <ChevronRight className="size-3.5" />
                </button>
              }
            >
              {t('builds.screenshots')}
            </SectionHeading>
            <div className="grid grid-cols-2 gap-2.5">
              {previews.map((index) => (
                <button
                  key={index}
                  type="button"
                  onClick={onViewScreenshots}
                  aria-label={t('builds.screenshots')}
                  className={cn(
                    'aspect-video overflow-hidden rounded-lg border border-edge',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  )}
                >
                  <BuildScreenshot
                    item={item}
                    index={index}
                    className="size-full object-cover transition-transform duration-300 ease-standard motion-safe:hover:scale-105"
                  />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

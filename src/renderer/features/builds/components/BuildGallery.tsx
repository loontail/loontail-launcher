import { SectionHeading } from '@renderer/shared/ui/SectionHeading';
import type { CatalogItem } from '@shared/contracts/catalog';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildScreenshot, buildScreenshotCount } from './BuildMedia';

const Carousel = lazy(() => import('./Carousel').then((module) => ({ default: module.Carousel })));

export const BuildGallery = ({ item }: { item: CatalogItem }) => {
  const { t } = useTranslation();
  const count = buildScreenshotCount(item);
  if (count === 0) return null;

  return (
    <section>
      <SectionHeading>{t('builds.screenshots')}</SectionHeading>
      <Suspense
        fallback={
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-edge">
            <BuildScreenshot item={item} index={0} className="h-full w-full object-cover" />
          </div>
        }
      >
        <Carousel autoPlay>
          {Array.from({ length: count }).map((_, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: screenshots are an ordered, stable list
              key={index}
              className="relative aspect-video w-full overflow-hidden rounded-lg border border-edge"
            >
              <BuildScreenshot item={item} index={index} className="h-full w-full object-cover" />
            </div>
          ))}
        </Carousel>
      </Suspense>
    </section>
  );
};

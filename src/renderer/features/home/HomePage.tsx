import { BuildSettingsModal } from '@renderer/features/builds';
import { cn } from '@renderer/shared/lib/cn';
import { PAGE_CONTAINER } from '@renderer/shared/lib/layout';
import { useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import { Skeleton } from '@renderer/shared/ui/Skeleton';
import type { CatalogItem } from '@shared/contracts/catalog';
import { useState } from 'react';
import { HomeEmptyState } from './HomeEmptyState';
import { HomeHero } from './HomeHero';
import { RecentFilmstrip } from './RecentFilmstrip';
import { useRecentBuilds } from './useRecentBuilds';

const HomeSkeleton = () => (
  <div className="absolute inset-0 bg-surface-0">
    <div className={cn(PAGE_CONTAINER, 'flex h-full flex-col justify-center pb-48 pt-14')}>
      <div className="flex max-w-2xl flex-col gap-4">
        <Skeleton className="h-3 w-32 rounded-sm" />
        <Skeleton className="h-14 w-80 rounded-md" />
        <Skeleton className="h-4 w-52 rounded-sm" />
        <Skeleton className="mt-3 h-11 w-40 rounded-md" />
      </div>
    </div>
    <div className="absolute inset-x-0 bottom-0 pb-6">
      <div className={cn(PAGE_CONTAINER, 'flex gap-3')}>
        {Array.from({ length: 5 }).map((_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeletons have no identity
          <Skeleton key={index} className="h-24 w-44 shrink-0 rounded-lg" />
        ))}
      </div>
    </div>
  </div>
);

export const HomePage = () => {
  const { recent, isPending } = useRecentBuilds();
  const push = useNavigationStore((s) => s.push);
  const [index, setIndex] = useState(0);
  const [settingsItem, setSettingsItem] = useState<CatalogItem | null>(null);

  if (isPending) {
    return (
      <div className="relative h-full overflow-hidden">
        <HomeSkeleton />
      </div>
    );
  }

  if (recent.length === 0) {
    return <HomeEmptyState />;
  }

  const safeIndex = Math.min(index, recent.length - 1);
  const active = recent[safeIndex];
  if (!active) return null;

  const open = (item: CatalogItem): void => push({ name: 'build', key: item.key });

  return (
    <div className="relative h-full overflow-hidden">
      <div key={active.key} className="absolute inset-0 motion-safe:animate-route-fade">
        <HomeHero
          item={active}
          onOpenSettings={() => setSettingsItem(active)}
          onOpenDetails={() => open(active)}
        />
      </div>

      <output aria-live="polite" className="sr-only">
        {active.presentation.title}
      </output>

      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-canvas via-canvas/85 to-transparent pb-6 pt-12">
        <div className={PAGE_CONTAINER}>
          <RecentFilmstrip items={recent} activeIndex={safeIndex} onSelect={setIndex} />
        </div>
      </div>

      {settingsItem && (
        <BuildSettingsModal item={settingsItem} isOpen onClose={() => setSettingsItem(null)} />
      )}
    </div>
  );
};

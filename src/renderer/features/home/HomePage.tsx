import { useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import { Skeleton } from '@renderer/shared/ui/Skeleton';
import { Boxes } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ContinueCard } from './ContinueCard';
import { RecentStrip } from './RecentStrip';
import { useRecentBuilds } from './useRecentBuilds';

const SectionHeading = ({ children }: { children: string }) => (
  <h2 className="text-microlabel font-bold uppercase tracking-eyebrow text-glass/40">{children}</h2>
);

const HomeSkeleton = () => (
  <>
    <Skeleton className="h-52 w-full rounded-lg" />
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
      {Array.from({ length: 5 }).map((_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeletons have no identity
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="aspect-video w-full rounded-md" />
          <Skeleton className="h-3.5 w-3/4 rounded-sm" />
        </div>
      ))}
    </div>
  </>
);

const HomeEmptyState = ({ onBrowse }: { onBrowse: () => void }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl border border-edge bg-chip-dark text-glass/40">
        <Boxes className="size-7" />
      </span>
      <p className="max-w-sm text-sm text-glass/55">{t('home.emptyTitle')}</p>
      <button
        type="button"
        onClick={onBrowse}
        className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
      >
        {t('home.emptyCta')}
      </button>
    </div>
  );
};

export const HomePage = () => {
  const { t } = useTranslation();
  const { recent, isPending } = useRecentBuilds();
  const push = useNavigationStore((s) => s.push);

  const renderBody = (): ReactNode => {
    if (isPending) return <HomeSkeleton />;
    const [hero, ...rest] = recent;
    if (!hero) {
      return <HomeEmptyState onBrowse={() => push({ name: 'builds' })} />;
    }
    return (
      <>
        <ContinueCard item={hero} />
        {rest.length > 0 && (
          <section className="flex flex-col gap-3">
            <SectionHeading>{t('home.recentlyPlayed')}</SectionHeading>
            <RecentStrip items={rest} />
          </section>
        )}
      </>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-295 flex-col gap-8 px-8 py-8">
        {renderBody()}
      </div>
    </div>
  );
};

import { useCatalog } from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import { PAGE_CONTAINER } from '@renderer/shared/lib/layout';
import { useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import { Segmented } from '@renderer/shared/ui/Segmented';
import { type CatalogItem, SourceKinds } from '@shared/contracts/catalog';
import { Boxes, LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildCard } from './BuildCard';
import { BuildGrid } from './BuildGrid';
import { BuildGridSkeleton } from './BuildGridSkeleton';
import { CreateBuildModal } from './CreateBuildModal';
import { type BuildViewMode, buildViewModeStore } from './viewMode';

const SectionHeading = ({ title, aside }: { title: string; aside?: ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <h2 className="text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">{title}</h2>
    {aside}
  </div>
);

// Shown under "My builds" when the user has authored none. Their own builds are
// always created here, so this carries the single create affordance for the
// empty case (the section header drops its button when there's nothing beside).
const MyBuildsEmpty = ({ onCreate }: { onCreate: () => void }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-edge-md bg-surface-1/40 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-edge bg-surface-2 text-text-mute">
        <Boxes className="size-6" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-body-med text-text-hi">{t('clients.myBuildsEmptyTitle')}</p>
        <p className="text-caption text-text-mute">{t('clients.myBuildsEmptyDescription')}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onCreate}>
        <Plus className="size-4" />
        {t('clients.createBuild')}
      </Button>
    </div>
  );
};

const matchesQuery = (item: CatalogItem, query: string): boolean =>
  item.presentation.title.toLowerCase().includes(query);

export const BuildsHomePage = () => {
  const { t } = useTranslation();
  const { items, isPending } = useCatalog();
  const push = useNavigationStore((s) => s.push);
  const viewMode = buildViewModeStore.useValue();
  const setViewMode = buildViewModeStore.useSetValue();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const openBuild = (item: CatalogItem): void => push({ name: 'build', key: item.key });

  const { localItems, officialItems } = useMemo(() => {
    const filtered = query ? items.filter((item) => matchesQuery(item, query)) : items;
    return {
      localItems: filtered.filter((item) => item.kind === SourceKinds.LOCAL),
      officialItems: filtered.filter((item) => item.kind === SourceKinds.OFFICIAL),
    };
  }, [items, query]);

  const renderTiles = (group: CatalogItem[]): ReactNode =>
    group.map((item) => (
      <BuildCard key={item.key} item={item} onOpen={openBuild} variant={viewMode} />
    ));

  // My builds always shows (with its own empty state); Official only appears when
  // there are official builds to list — an empty/unreachable catalog hides it.
  const showMyBuilds = !query || localItems.length > 0;
  const showOfficial = officialItems.length > 0;
  const noResults = query.length > 0 && localItems.length === 0 && officialItems.length === 0;

  const renderBody = (): ReactNode => {
    if (isPending) return <BuildGridSkeleton />;
    if (noResults) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl border border-edge bg-surface-1 text-text-mute">
            <Search className="size-6" />
          </span>
          <p className="max-w-sm text-body text-text-mute">
            {t('clients.noResults', { query: search.trim() })}
          </p>
          <Button variant="secondary" onClick={() => setSearch('')}>
            <X className="size-4" />
            {t('clients.clearSearch')}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-8">
        {showMyBuilds && (
          <section className="flex flex-col gap-3.5">
            <SectionHeading
              title={t('clients.myBuilds')}
              aside={
                !query && localItems.length > 0 ? (
                  <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="size-4" />
                    {t('clients.createBuild')}
                  </Button>
                ) : undefined
              }
            />
            {localItems.length > 0 ? (
              <BuildGrid variant={viewMode} roving resetKey={`my:${viewMode}:${localItems.length}`}>
                {renderTiles(localItems)}
              </BuildGrid>
            ) : (
              <MyBuildsEmpty onCreate={() => setCreateOpen(true)} />
            )}
          </section>
        )}

        {showOfficial && (
          <section className="flex flex-col gap-3.5">
            <SectionHeading
              title={t('clients.official')}
              aside={<span className="text-caption text-text-mute">{t('clients.curatedBy')}</span>}
            />
            <BuildGrid
              variant={viewMode}
              roving
              resetKey={`official:${viewMode}:${officialItems.length}`}
            >
              {renderTiles(officialItems)}
            </BuildGrid>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto pt-12">
      <div className={cn(PAGE_CONTAINER, 'flex min-h-full flex-col gap-7 pb-12 pt-6')}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-display text-text-hi">{t('nav.builds')}</h1>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-mute" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('clients.searchPlaceholder')}
              aria-label={t('clients.searchPlaceholder')}
              className="h-10 rounded-md border-edge bg-surface-1 pl-9"
            />
          </div>
          <Segmented<BuildViewMode>
            ariaLabel={t('clients.viewToggleAria')}
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'grid', icon: LayoutGrid, ariaLabel: t('clients.viewGrid') },
              { value: 'list', icon: List, ariaLabel: t('clients.viewList') },
            ]}
          />
        </div>
        {renderBody()}
      </div>

      {createOpen && (
        <CreateBuildModal
          isOpen
          onClose={() => setCreateOpen(false)}
          onCreated={(item) => openBuild(item)}
        />
      )}
    </div>
  );
};

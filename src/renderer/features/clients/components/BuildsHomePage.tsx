import { useCatalog } from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import { useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import { Input } from '@renderer/shared/ui/Input';
import { QUERY_KEY_ROOTS } from '@shared/constants';
import { type CatalogItem, SourceKinds } from '@shared/contracts/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, LayoutGrid, List, Search, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildGrid } from './BuildGrid';
import { BuildGridSkeleton } from './BuildGridSkeleton';
import { BuildTile } from './BuildTile';
import { CreateBuildModal } from './CreateBuildModal';
import { CreateBuildTile } from './CreateBuildTile';
import { EmptyBuildsState } from './EmptyBuildsState';
import { type BuildViewMode, buildViewModeStore } from './viewMode';

const SectionHeading = ({ children }: { children: string }) => (
  <h2 className="text-microlabel font-bold uppercase tracking-eyebrow text-glass/40">{children}</h2>
);

const matchesQuery = (item: CatalogItem, query: string): boolean =>
  item.presentation.title.toLowerCase().includes(query);

const ViewModeToggle = ({
  mode,
  onChange,
}: {
  mode: BuildViewMode;
  onChange: (mode: BuildViewMode) => void;
}) => {
  const { t } = useTranslation();
  const options: { value: BuildViewMode; icon: typeof LayoutGrid; label: string }[] = [
    { value: 'grid', icon: LayoutGrid, label: t('clients.viewGrid') },
    { value: 'list', icon: List, label: t('clients.viewList') },
  ];
  return (
    <div className="inline-flex shrink-0 rounded-md border border-edge-md bg-chip-dark p-0.5">
      {options.map(({ value, icon: Icon, label }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={label}
            onClick={() => onChange(value)}
            className={cn(
              'flex size-7 items-center justify-center rounded-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/40',
              active ? 'bg-surface-2 text-glass' : 'text-text-mute hover:text-glass',
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
};

export const BuildsHomePage = () => {
  const { t } = useTranslation();
  const { items, officialOk, isPending } = useCatalog();
  const push = useNavigationStore((s) => s.push);
  const queryClient = useQueryClient();
  const viewMode = buildViewModeStore.useValue();
  const setViewMode = buildViewModeStore.useSetValue();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const openBuild = (item: CatalogItem): void => push({ name: 'build', key: item.key });
  const refetchCatalog = (): void => {
    void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOTS.catalog] });
  };

  const { localItems, officialItems } = useMemo(() => {
    const filtered = query ? items.filter((item) => matchesQuery(item, query)) : items;
    return {
      localItems: filtered.filter((item) => item.kind === SourceKinds.LOCAL),
      officialItems: filtered.filter((item) => item.kind === SourceKinds.OFFICIAL),
    };
  }, [items, query]);

  const renderTiles = (group: CatalogItem[]): ReactNode =>
    group.map((item) => (
      <BuildTile key={item.key} item={item} onOpen={openBuild} variant={viewMode} />
    ));

  // My Builds always offers the create affordance when not searching, so the
  // group is "present" whenever there are local matches OR no search is active.
  const showMyBuilds = !query || localItems.length > 0;
  const showOfficial = officialItems.length > 0 || (!query && !officialOk);
  const noResults = query.length > 0 && localItems.length === 0 && officialItems.length === 0;
  const trulyEmpty = !query && items.length === 0 && officialOk;

  const renderOfficialBody = (): ReactNode => {
    if (officialItems.length > 0) {
      return (
        <BuildGrid variant={viewMode} roving resetKey={`${viewMode}:${officialItems.length}`}>
          {renderTiles(officialItems)}
        </BuildGrid>
      );
    }
    if (!officialOk) {
      return (
        <div className="flex items-center gap-2 rounded-md border border-edge bg-chip-dark px-3 py-2.5 text-caption text-text-mute">
          <CloudOff className="size-4 shrink-0" />
          {t('clients.officialUnavailable')}
        </div>
      );
    }
    return <p className="text-caption text-text-mute">{t('clients.officialEmpty')}</p>;
  };

  const renderBody = (): ReactNode => {
    if (isPending) return <BuildGridSkeleton />;
    if (trulyEmpty) {
      return (
        <EmptyBuildsState onCreate={() => setCreateOpen(true)} onBrowseOfficial={refetchCatalog} />
      );
    }
    if (noResults) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl border border-edge bg-surface-1 text-text-mute">
            <Search className="size-6" />
          </span>
          <p className="max-w-sm text-body text-text-mute">
            {t('clients.noResults', { query: search.trim() })}
          </p>
          <button
            type="button"
            onClick={() => setSearch('')}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-edge-md bg-surface-1 px-4 py-2 text-body-med text-glass transition-colors hover:border-edge-lg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
          >
            <X className="size-4" />
            {t('clients.clearSearch')}
          </button>
        </div>
      );
    }
    return (
      <>
        {showMyBuilds && (
          <section className="flex flex-col gap-3">
            <SectionHeading>{t('clients.myBuilds')}</SectionHeading>
            <BuildGrid
              variant={viewMode}
              roving
              resetKey={`${viewMode}:${query ? 0 : 1}:${localItems.length}`}
            >
              {!query && <CreateBuildTile onClick={() => setCreateOpen(true)} />}
              {renderTiles(localItems)}
            </BuildGrid>
          </section>
        )}

        {showOfficial && (
          <section className="flex flex-col gap-3">
            <SectionHeading>{t('clients.official')}</SectionHeading>
            {renderOfficialBody()}
          </section>
        )}
      </>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-295 flex-col gap-6 px-8 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-h1 text-glass">{t('nav.builds')}</h1>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-mute" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('clients.searchPlaceholder')}
              aria-label={t('clients.searchPlaceholder')}
              className="pl-8"
            />
          </div>
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
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

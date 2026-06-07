import { useCatalog } from '@renderer/features/catalog';
import { type CatalogItem, SourceKinds } from '@shared/contracts/catalog';
import { CloudOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildDetailModal } from './BuildDetailModal';
import { BuildGrid } from './BuildGrid';
import { BuildGridSkeleton } from './BuildGridSkeleton';
import { BuildTile } from './BuildTile';
import { CreateBuildModal } from './CreateBuildModal';
import { CreateBuildTile } from './CreateBuildTile';
import { EmptyBuildsState } from './EmptyBuildsState';

const SectionHeading = ({ children }: { children: string }) => (
  <h2 className="text-microlabel font-bold uppercase tracking-eyebrow text-glass/40">{children}</h2>
);

export const BuildsHomePage = () => {
  const { t } = useTranslation();
  const { items, officialOk, isPending } = useCatalog();
  const [detailItem, setDetailItem] = useState<CatalogItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const localItems = items.filter((item) => item.kind === SourceKinds.LOCAL);
  const officialItems = items.filter((item) => item.kind === SourceKinds.OFFICIAL);
  const isEmpty = !isPending && items.length === 0 && officialOk;

  // Re-resolve the open build against the latest catalog data (so create/delete/
  // status refetches reflect in the modal); fall back to the captured item while
  // a just-created build hasn't landed in the refetched list yet.
  const openItem = detailItem
    ? (items.find((item) => item.key === detailItem.key) ?? detailItem)
    : null;

  const renderOfficialSection = (): ReactNode => {
    if (officialItems.length > 0) {
      return (
        <BuildGrid>
          {officialItems.map((item) => (
            <BuildTile key={item.key} item={item} onOpen={setDetailItem} />
          ))}
        </BuildGrid>
      );
    }
    if (!officialOk) {
      return (
        <div className="flex items-center gap-2 rounded-md border border-edge bg-chip-dark px-3 py-2.5 text-caption text-glass/50">
          <CloudOff className="size-4 shrink-0" />
          {t('clients.officialUnavailable')}
        </div>
      );
    }
    return <p className="text-caption text-glass/40">{t('clients.officialEmpty')}</p>;
  };

  const renderCatalog = (): ReactNode => {
    if (isPending) return <BuildGridSkeleton />;
    if (isEmpty) return <EmptyBuildsState onCreate={() => setCreateOpen(true)} />;
    return (
      <>
        <section className="flex flex-col gap-3">
          <SectionHeading>{t('clients.myBuilds')}</SectionHeading>
          <BuildGrid>
            <CreateBuildTile onClick={() => setCreateOpen(true)} />
            {localItems.map((item) => (
              <BuildTile key={item.key} item={item} onOpen={setDetailItem} />
            ))}
          </BuildGrid>
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeading>{t('clients.official')}</SectionHeading>
          {renderOfficialSection()}
        </section>
      </>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col gap-8 px-8 py-8">
        {renderCatalog()}
      </div>

      {openItem && (
        <BuildDetailModal
          key={openItem.key}
          item={openItem}
          isOpen
          onClose={() => setDetailItem(null)}
        />
      )}
      {createOpen && (
        <CreateBuildModal
          isOpen
          onClose={() => setCreateOpen(false)}
          onCreated={(item) => setDetailItem(item)}
        />
      )}
    </div>
  );
};

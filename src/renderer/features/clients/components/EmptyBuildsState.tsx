import { Boxes, Cloud, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type EmptyBuildsStateProps = {
  onCreate: () => void;
  onBrowseOfficial: () => void;
};

// Shown when the user has no local builds and no official builds are available
// (fresh install, or CMS down with an empty local catalog).
export const EmptyBuildsState = ({ onCreate, onBrowseOfficial }: EmptyBuildsStateProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-20 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl border border-edge bg-surface-1 text-text-mute">
        <Boxes className="size-7" />
      </span>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-h1 text-glass">{t('clients.emptyTitle')}</h2>
        <p className="text-body text-text-mute">{t('clients.emptyDescription')}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBrowseOfficial}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-cta px-4 py-2 text-body-med text-on-cta transition-colors hover:bg-cta-hover active:bg-cta-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
        >
          <Cloud className="size-4" />
          {t('clients.browseOfficial')}
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-edge-md bg-surface-1 px-4 py-2 text-body-med text-glass transition-colors hover:border-edge-lg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
        >
          <Plus className="size-4" />
          {t('clients.createBuild')}
        </button>
      </div>
    </div>
  );
};

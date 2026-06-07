import { Boxes, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type EmptyBuildsStateProps = {
  onCreate: () => void;
};

// Shown when the user has no local builds and no official builds are available
// (fresh install, or CMS down with an empty local catalog).
export const EmptyBuildsState = ({ onCreate }: EmptyBuildsStateProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl border border-edge bg-chip-dark text-glass/40">
        <Boxes className="size-7" />
      </span>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-lg font-bold text-glass">{t('clients.emptyTitle')}</h2>
        <p className="text-sm text-glass/55">{t('clients.emptyDescription')}</p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
      >
        <Plus className="size-4" />
        {t('clients.createBuild')}
      </button>
    </div>
  );
};

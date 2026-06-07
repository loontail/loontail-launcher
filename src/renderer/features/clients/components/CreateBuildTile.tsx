import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type CreateBuildTileProps = {
  onClick: () => void;
};

// Dashed grid card matching a build card's footprint, leading the My Builds
// group as the affordance to create a new local build.
export const CreateBuildTile = ({ onClick }: CreateBuildTileProps) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-edge-lg bg-surface-1/40 p-4 text-center text-text-mute transition-all duration-150 ease-standard hover:border-edge-xl hover:bg-surface-2 hover:text-glass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50 motion-safe:hover:scale-[1.02] active:scale-[0.99]"
    >
      <span className="flex size-11 items-center justify-center rounded-full border border-dashed border-edge-lg transition-colors group-hover:border-edge-xl">
        <Plus className="size-5" />
      </span>
      <span className="text-body-med">{t('clients.createBuild')}</span>
    </button>
  );
};

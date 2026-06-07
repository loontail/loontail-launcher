import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type CreateBuildTileProps = {
  onClick: () => void;
};

export const CreateBuildTile = ({ onClick }: CreateBuildTileProps) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-3.5 rounded-lg border border-dashed border-edge-md bg-chip-dark/20 px-3.5 py-3 text-left text-glass/55 transition-all duration-150 hover:border-edge-lg hover:bg-chip-dark/40 hover:text-glass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed border-edge-md bg-glass/5 transition-colors group-hover:border-edge-lg group-hover:bg-glass/10">
        <Plus className="size-5" />
      </span>
      <span className="text-sm font-semibold">{t('clients.createBuild')}</span>
    </button>
  );
};

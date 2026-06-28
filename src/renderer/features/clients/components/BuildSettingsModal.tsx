import { Modal } from '@renderer/shared/ui/Modal';
import type { CatalogItem } from '@shared/contracts/catalog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BuildIcon } from './BuildIcon';
import { BuildSettingsTab } from './BuildSettingsTab';

type BuildSettingsModalProps = {
  item: CatalogItem;
  isOpen: boolean;
  onClose: () => void;
  onBuildDeleted?: () => void;
};

export const BuildSettingsModal = ({
  item,
  isOpen,
  onClose,
  onBuildDeleted,
}: BuildSettingsModalProps) => {
  const { t } = useTranslation();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      scrollable
      ariaLabel={t('clients.openDetails', { name: item.presentation.title })}
      className="max-w-xl gap-5"
    >
      <div className="flex items-center gap-3">
        <BuildIcon item={item} className="size-10 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-h2 font-bold text-text-hi">{item.presentation.title}</h2>
          <p className="text-caption text-text-mute">{t('clients.tabs.settings')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-mute transition-colors hover:bg-ghost-hover hover:text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X className="size-4" />
        </button>
      </div>
      <BuildSettingsTab item={item} onBuildDeleted={onBuildDeleted ?? onClose} />
    </Modal>
  );
};

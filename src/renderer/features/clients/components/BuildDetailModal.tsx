import { Modal } from '@renderer/shared/ui/Modal';
import type { CatalogItem } from '@shared/contracts/catalog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BuildAbout } from './BuildAbout';
import { BuildGallery } from './BuildGallery';
import { BuildHero } from './BuildHero';
import { BuildMedia } from './BuildMedia';

type BuildDetailModalProps = {
  item: CatalogItem;
  isOpen: boolean;
  onClose: () => void;
};

// The client overview hosted in a modal: a fixed full-bleed key-art backdrop
// with the launcher's familiar content (title, chips, launch row, servers, then
// screenshots + about) scrolling over it. Official builds get rich imagery;
// local builds get a clean generated backdrop.
export const BuildDetailModal = ({ item, isOpen, onClose }: BuildDetailModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('clients.detailAria', { name: item.presentation.title })}
      className="relative h-[calc(100vh-4rem)] max-h-[920px] w-[calc(100vw-4rem)] max-w-270 gap-0 overflow-hidden p-0"
    >
      {/* Fixed full-bleed backdrop — stays put while content scrolls over it. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <BuildMedia
          item={item}
          slot="background"
          fallback="visual"
          className="h-full w-full object-cover brightness-[0.55]"
        />
        <div className="absolute inset-0 bg-linear-to-r from-overlay/85 via-overlay/55 to-overlay/15" />
        <div className="absolute inset-0 bg-linear-to-t from-overlay/90 via-overlay/30 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-32 bg-linear-to-b from-overlay/70 to-transparent" />
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label={t('clientSettings.close')}
        className="absolute right-3 top-3 z-30 flex size-9 cursor-pointer items-center justify-center rounded-full bg-overlay/60 text-glass/80 ring-1 ring-edge-md backdrop-blur-md transition-all hover:bg-overlay/80 hover:text-glass hover:ring-edge-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
      >
        <X className="size-4" />
      </button>

      <div className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden">
        <BuildHero item={item} onDeleted={onClose} />

        <div className="flex flex-col gap-10 px-12 pb-16">
          <BuildGallery item={item} />
          <BuildAbout item={item} />
        </div>
      </div>
    </Modal>
  );
};

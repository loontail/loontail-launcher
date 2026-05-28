import { Button } from '@renderer/shared/ui/Button';
import { Modal } from '@renderer/shared/ui/Modal';
import { useTranslation } from 'react-i18next';

type UninstallConfirmModalProps = {
  isOpen: boolean;
  clientTitle: string;
  onClose: () => void;
  onConfirm: () => void;
};

export const UninstallConfirmModal = ({
  isOpen,
  clientTitle,
  onClose,
  onConfirm,
}: UninstallConfirmModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('clientSettings.uninstallConfirmTitle')}
      className="max-w-sm"
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t('clientSettings.uninstallConfirmTitle')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('clientSettings.uninstallConfirm', { name: clientTitle })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          {t('clientSettings.uninstall')}
        </Button>
      </div>
    </Modal>
  );
};

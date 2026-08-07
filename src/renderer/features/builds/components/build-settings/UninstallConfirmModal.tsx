import { Button } from '@renderer/shared/ui/Button';
import { Modal } from '@renderer/shared/ui/Modal';
import { useTranslation } from 'react-i18next';

type UninstallConfirmModalProps = {
  isOpen: boolean;
  clientTitle: string;
  onClose: () => void;
  onConfirm: () => void;
  // Copy overrides so this dialog backs both uninstall and local-build delete.
  title?: string;
  message?: string;
  confirmLabel?: string;
};

export const UninstallConfirmModal = ({
  isOpen,
  clientTitle,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
}: UninstallConfirmModalProps) => {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('buildSettings.uninstallConfirmTitle');

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={resolvedTitle} className="max-w-sm">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-hi">{resolvedTitle}</h3>
        <p className="text-xs text-text-mute">
          {message ?? t('buildSettings.uninstallConfirm', { name: clientTitle })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          {confirmLabel ?? t('buildSettings.uninstall')}
        </Button>
      </div>
    </Modal>
  );
};

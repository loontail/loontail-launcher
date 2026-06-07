import { Button } from '@renderer/shared/ui/Button';
import { Modal } from '@renderer/shared/ui/Modal';
import { useTranslation } from 'react-i18next';

type UninstallConfirmModalProps = {
  isOpen: boolean;
  clientTitle: string;
  onClose: () => void;
  onConfirm: () => void;
  // Optional copy overrides so the same confirm dialog backs both uninstall
  // (default) and the local-build delete flow.
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
  const resolvedTitle = title ?? t('clientSettings.uninstallConfirmTitle');

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={resolvedTitle} className="max-w-sm">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">{resolvedTitle}</h3>
        <p className="text-xs text-muted-foreground">
          {message ?? t('clientSettings.uninstallConfirm', { name: clientTitle })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          {confirmLabel ?? t('clientSettings.uninstall')}
        </Button>
      </div>
    </Modal>
  );
};

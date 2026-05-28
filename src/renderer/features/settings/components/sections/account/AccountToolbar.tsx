import { Button } from '@renderer/shared/ui/Button';
import { CapeUploadIcon } from '@renderer/shared/ui/icons/CapeUploadIcon';
import { SkinUploadIcon } from '@renderer/shared/ui/icons/SkinUploadIcon';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type AccountIdleToolbarProps = {
  showCape: boolean;
  isBusy: boolean;
  canReset: boolean;
  onPickSkin: () => void;
  onPickCape: () => void;
  onReset: () => void;
};

export const AccountIdleToolbar = ({
  showCape,
  isBusy,
  canReset,
  onPickSkin,
  onPickCape,
  onReset,
}: AccountIdleToolbarProps) => {
  const { t } = useTranslation();

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={onPickSkin}
        disabled={isBusy}
        className="gap-1.5 whitespace-nowrap"
      >
        <SkinUploadIcon className="size-4" />
        {t('settings.account.uploadSkin')}
      </Button>
      {showCape && (
        <Button
          variant="outline"
          size="sm"
          onClick={onPickCape}
          disabled={isBusy}
          className="gap-1.5 whitespace-nowrap"
        >
          <CapeUploadIcon className="size-4" />
          {t('settings.account.uploadCape')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={isBusy || !canReset}
        className="ml-auto gap-1.5 whitespace-nowrap text-muted-foreground hover:text-foreground"
        title={t('settings.account.resetToDefault')}
      >
        <RotateCcw className="size-3.5" />
        {t('settings.account.reset')}
      </Button>
    </>
  );
};

type AccountPendingToolbarProps = {
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
};

export const AccountPendingToolbar = ({
  isSaving,
  onCancel,
  onSave,
}: AccountPendingToolbarProps) => {
  const { t } = useTranslation();

  return (
    <>
      <span className="mr-auto text-xs text-muted-foreground">
        {t('settings.account.unsavedHint')}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={isSaving}
        className="gap-1.5 whitespace-nowrap"
      >
        <X className="size-3.5" />
        {t('settings.account.cancel')}
      </Button>
      <Button size="sm" onClick={onSave} disabled={isSaving} className="gap-1.5 whitespace-nowrap">
        {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        {t('settings.account.save')}
      </Button>
    </>
  );
};

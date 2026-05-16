import { Button } from '@renderer/shared/ui/Button';
import { Modal } from '@renderer/shared/ui/Modal';
import { LoaderChoices } from '@shared/contracts/settings';
import { Boxes, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ModdedLoaderChoice = typeof LoaderChoices.FORGE | typeof LoaderChoices.FABRIC;

type LoaderChoiceModalProps = {
  isOpen: boolean;
  clientTitle: string;
  forgeVersion?: string | null | undefined;
  fabricVersion?: string | null | undefined;
  onPick: (loader: ModdedLoaderChoice) => void;
  onClose: () => void;
};

const LOADER_OPTIONS: ReadonlyArray<{
  readonly value: ModdedLoaderChoice;
  readonly labelKey: string;
}> = [
  { value: LoaderChoices.FORGE, labelKey: 'clients.loaderModal.forge' },
  { value: LoaderChoices.FABRIC, labelKey: 'clients.loaderModal.fabric' },
];

export const LoaderChoiceModal = ({
  isOpen,
  clientTitle,
  forgeVersion,
  fabricVersion,
  onPick,
  onClose,
}: LoaderChoiceModalProps) => {
  const { t } = useTranslation();
  const versionOf = (loader: ModdedLoaderChoice): string | null | undefined =>
    loader === LoaderChoices.FORGE ? forgeVersion : fabricVersion;

  const handlePick = (loader: ModdedLoaderChoice): void => {
    onPick(loader);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('clients.loaderModal.title')}
      className="max-w-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-base font-semibold text-foreground">
            {t('clients.loaderModal.title')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('clients.loaderModal.subtitle', { name: clientTitle })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {LOADER_OPTIONS.map(({ value, labelKey }) => {
          const version = versionOf(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => handlePick(value)}
              className="group flex items-center justify-between rounded-md border border-border bg-muted/40 p-4 text-left transition-colors hover:bg-muted"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">{t(labelKey)}</span>
                {version && <span className="text-xs text-muted-foreground">v{version}</span>}
              </div>
              <Boxes className="size-5 text-muted-foreground group-hover:text-foreground" />
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
};

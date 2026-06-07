import {
  useCreateBuild,
  useLoaderVersions,
  useMinecraftVersions,
} from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import { Modal } from '@renderer/shared/ui/Modal';
import type { CatalogItem } from '@shared/contracts/catalog';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

const LOADER_OPTIONS: LoaderChoice[] = [
  LoaderChoices.VANILLA,
  LoaderChoices.FABRIC,
  LoaderChoices.FORGE,
];

const SELECT_CLASS =
  'flex h-9 w-full rounded-sm border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

type CreateBuildModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (item: CatalogItem) => void;
};

export const CreateBuildModal = ({ isOpen, onClose, onCreated }: CreateBuildModalProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [minecraftVersion, setMinecraftVersion] = useState('');
  const [loader, setLoader] = useState<LoaderChoice>(LoaderChoices.VANILLA);
  const [loaderVersion, setLoaderVersion] = useState('');

  const mcVersions = useMinecraftVersions(isOpen);
  const needsLoaderVersion = loader !== LoaderChoices.VANILLA;
  const loaderVersions = useLoaderVersions(loader, minecraftVersion, isOpen && needsLoaderVersion);
  const create = useCreateBuild();

  // Selecting a loader or MC version clears any pinned loader version — a value
  // from the previous selection would not be in the new list.
  const selectLoader = (next: LoaderChoice): void => {
    setLoader(next);
    setLoaderVersion('');
  };
  const selectMinecraftVersion = (next: string): void => {
    setMinecraftVersion(next);
    setLoaderVersion('');
  };

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && minecraftVersion.length > 0 && !create.isPending;

  let minecraftPlaceholder = t('createBuild.selectVersion');
  if (mcVersions.isPending) minecraftPlaceholder = t('createBuild.loading');
  else if (mcVersions.isError) minecraftPlaceholder = t('createBuild.versionsUnavailable');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    void create
      .mutateAsync({
        name: trimmedName,
        minecraftVersion,
        loader,
        ...(needsLoaderVersion && loaderVersion ? { loaderVersion } : {}),
      })
      .then((item) => {
        onCreated(item);
        onClose();
      })
      .catch(() => {
        // Surfaced inline via create.isError; nothing else to do here.
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      scrollable
      ariaLabel={t('createBuild.title')}
      className="max-w-md"
    >
      <h2 className="text-base font-semibold text-foreground">{t('createBuild.title')}</h2>

      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label htmlFor="create-build-name" className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('createBuild.name')}</span>
          <Input
            id="create-build-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('createBuild.namePlaceholder')}
            maxLength={80}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('createBuild.minecraftVersion')}
          </span>
          <select
            className={SELECT_CLASS}
            value={minecraftVersion}
            onChange={(event) => selectMinecraftVersion(event.target.value)}
            disabled={mcVersions.isPending || mcVersions.isError}
          >
            <option value="">{minecraftPlaceholder}</option>
            {mcVersions.data?.map((version) => (
              <option key={version.id} value={version.id}>
                {version.id}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('createBuild.loader')}
          </span>
          <div className="inline-flex w-fit rounded-full border border-edge-md bg-chip-dark p-0.5">
            {LOADER_OPTIONS.map((option) => {
              const active = loader === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectLoader(option)}
                  className={cn(
                    'rounded-full px-3 py-1 text-eyebrow font-semibold transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-glass/65 hover:text-glass',
                  )}
                >
                  {t(`clientSettings.loader.${option}`)}
                </button>
              );
            })}
          </div>
        </div>

        {needsLoaderVersion && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('createBuild.loaderVersion')}
            </span>
            <select
              className={SELECT_CLASS}
              value={loaderVersion}
              onChange={(event) => setLoaderVersion(event.target.value)}
              disabled={!minecraftVersion || loaderVersions.isPending}
            >
              <option value="">{t('createBuild.loaderVersionAuto')}</option>
              {loaderVersions.data?.map((option) => (
                <option key={option.version} value={option.version}>
                  {option.recommended
                    ? t('createBuild.versionRecommended', { version: option.version })
                    : option.version}
                </option>
              ))}
            </select>
          </label>
        )}

        {create.isError && (
          <p role="alert" className="text-caption text-destructive">
            {t('createBuild.error')}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onClose}
            disabled={create.isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button size="sm" type="submit" disabled={!canSubmit}>
            {create.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {t('createBuild.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

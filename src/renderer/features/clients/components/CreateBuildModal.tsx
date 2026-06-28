import {
  useCreateBuild,
  useLoaderVersions,
  useMinecraftVersions,
} from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import { Modal } from '@renderer/shared/ui/Modal';
import { Segmented } from '@renderer/shared/ui/Segmented';
import type { CatalogItem } from '@shared/contracts/catalog';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';
import { ChevronDown, Loader2, Plus, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ICON_PRESETS, ICON_PRESET_KEYS, type IconPresetKey } from './iconPresets';

const LOADER_OPTIONS: LoaderChoice[] = [
  LoaderChoices.VANILLA,
  LoaderChoices.FABRIC,
  LoaderChoices.FORGE,
];

const SELECT_CLASS =
  'h-10 w-full appearance-none rounded-md border border-edge-md bg-surface-3 px-3 pr-9 text-body text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50';

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-2">
    <span className="text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">
      {label}
    </span>
    {children}
  </div>
);

const SelectChevron = () => (
  <ChevronDown
    className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-mute"
    aria-hidden
  />
);

type CreateBuildModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (item: CatalogItem) => void;
};

export const CreateBuildModal = ({ isOpen, onClose, onCreated }: CreateBuildModalProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<IconPresetKey>('blocks');
  const [minecraftVersion, setMinecraftVersion] = useState('');
  const [loader, setLoader] = useState<LoaderChoice>(LoaderChoices.VANILLA);
  const [loaderVersion, setLoaderVersion] = useState('');

  const mcVersions = useMinecraftVersions(isOpen);
  const needsLoaderVersion = loader !== LoaderChoices.VANILLA;
  const loaderVersions = useLoaderVersions(loader, minecraftVersion, isOpen && needsLoaderVersion);
  const create = useCreateBuild();

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
        iconPreset: icon,
        ...(needsLoaderVersion && loaderVersion ? { loaderVersion } : {}),
      })
      .then((item) => {
        onCreated(item);
        onClose();
      })
      .catch(() => {
        // Surfaced inline via create.isError.
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      scrollable
      ariaLabel={t('createBuild.title')}
      className="max-w-lg gap-5"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-2 text-text-hi">
          <Plus className="size-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-h2 font-bold text-text-hi">{t('createBuild.title')}</h2>
          <p className="text-caption text-text-mute">{t('createBuild.subtitle')}</p>
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

      <form className="flex flex-col gap-5" onSubmit={submit}>
        <Field label={t('createBuild.name')}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('createBuild.namePlaceholder')}
            aria-label={t('createBuild.name')}
            maxLength={80}
            className="h-10 rounded-md border-edge-md bg-surface-3 text-text-hi"
          />
        </Field>

        <Field label={t('createBuild.icon')}>
          <div
            role="radiogroup"
            aria-label={t('createBuild.icon')}
            className="flex flex-wrap gap-2"
          >
            {ICON_PRESET_KEYS.map((key) => {
              const Icon = ICON_PRESETS[key];
              const active = icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: icon picker uses radio buttons, not native inputs
                  role="radio"
                  aria-checked={active}
                  aria-label={key}
                  onClick={() => setIcon(key)}
                  className={cn(
                    'flex size-11 cursor-pointer items-center justify-center rounded-md border transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                    active
                      ? 'border-edge-lg bg-cta text-on-cta'
                      : 'border-edge-md bg-surface-3 text-text-mute hover:text-text-hi',
                  )}
                >
                  <Icon className="size-5" strokeWidth={2} />
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t('createBuild.minecraftVersion')}>
            <div className="relative">
              <select
                className={SELECT_CLASS}
                value={minecraftVersion}
                onChange={(event) => selectMinecraftVersion(event.target.value)}
                aria-label={t('createBuild.minecraftVersion')}
                disabled={mcVersions.isPending || mcVersions.isError}
              >
                <option value="">{minecraftPlaceholder}</option>
                {mcVersions.data?.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.id}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </Field>

          <Field label={t('createBuild.loader')}>
            <Segmented<LoaderChoice>
              ariaLabel={t('createBuild.loader')}
              value={loader}
              onChange={selectLoader}
              className="w-full"
              options={LOADER_OPTIONS.map((option) => ({
                value: option,
                label: t(`clientSettings.loader.${option}`),
              }))}
            />
          </Field>
        </div>

        {needsLoaderVersion && (
          <Field label={t('createBuild.loaderVersion')}>
            <div className="relative">
              <select
                className={SELECT_CLASS}
                value={loaderVersion}
                onChange={(event) => setLoaderVersion(event.target.value)}
                aria-label={t('createBuild.loaderVersion')}
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
              <SelectChevron />
            </div>
          </Field>
        )}

        {create.isError && (
          <p
            role="alert"
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-caption text-text"
          >
            {t('createBuild.error')}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-edge pt-4">
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            className="h-10"
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit} className="h-10">
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {t('createBuild.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

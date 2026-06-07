import type { Translator } from '@renderer/i18n';
import { cn } from '@renderer/shared/lib/cn';
import { OverrideMark } from '@renderer/shared/ui/OverrideMark';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import type { BuildSpec } from '@shared/contracts/catalog';
import { type LoaderChoice, LoaderChoices } from '@shared/contracts/settings';
import { resolveLoader } from '@shared/domain/loader';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const pickLoaderVersion = (loader: LoaderChoice | null, spec: BuildSpec): string | null => {
  if (loader === LoaderChoices.FORGE) return spec.forgeVersion ?? null;
  if (loader === LoaderChoices.FABRIC) return spec.fabricVersion ?? null;
  return null;
};

const renderLoaderKindControl = (args: {
  canSwitchLoader: boolean;
  effectiveLoader: LoaderChoice | null;
  isSavingOverride: boolean;
  switchLoader: (loader: typeof LoaderChoices.FORGE | typeof LoaderChoices.FABRIC) => void;
  t: Translator;
}): ReactNode => {
  const { canSwitchLoader, effectiveLoader, isSavingOverride, switchLoader, t } = args;
  if (canSwitchLoader) {
    return (
      <div
        aria-label={t('clientSettings.loader.title')}
        className="inline-flex rounded-full border border-edge-md bg-chip-dark p-0.5"
      >
        {[LoaderChoices.FORGE, LoaderChoices.FABRIC].map((option) => {
          const active = effectiveLoader === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              disabled={isSavingOverride || active}
              onClick={() => switchLoader(option)}
              className={cn(
                'rounded-full px-3 py-1 text-eyebrow font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/40',
                active ? 'bg-primary text-primary-foreground' : 'text-glass/65 hover:text-glass',
              )}
            >
              {t(`clientSettings.loader.${option}`)}
            </button>
          );
        })}
      </div>
    );
  }
  if (effectiveLoader) {
    return (
      <span className="text-caption font-semibold text-glass/85">
        {t(`clientSettings.loader.${effectiveLoader}`)}
      </span>
    );
  }
  return <span className="text-caption font-semibold text-glass/55">-</span>;
};

type ClientLoaderSectionProps = {
  spec: BuildSpec;
  loader: LoaderChoice | null;
  loaderOverridden: boolean;
  isSavingOverride: boolean;
  onSwitchLoader: (loader: typeof LoaderChoices.FORGE | typeof LoaderChoices.FABRIC) => void;
};

export const ClientLoaderSection = ({
  spec,
  loader,
  loaderOverridden,
  isSavingOverride,
  onSwitchLoader,
}: ClientLoaderSectionProps) => {
  const { t } = useTranslation();
  const resolution = resolveLoader(spec, loader);
  const effectiveLoader = resolution.kind === 'resolved' ? resolution.loader : null;
  const canSwitchLoader = Boolean(spec.forgeVersion) && Boolean(spec.fabricVersion);
  const loaderVersion = pickLoaderVersion(effectiveLoader, spec);

  return (
    <SettingsGroup title={t('clientSettings.loader.title')}>
      <SettingsRow
        label={
          <>
            {t('clientSettings.loader.kind')}
            <OverrideMark shown={loaderOverridden} />
          </>
        }
        description={canSwitchLoader ? t('clientSettings.loader.switchDesc') : undefined}
        right={renderLoaderKindControl({
          canSwitchLoader,
          effectiveLoader,
          isSavingOverride,
          switchLoader: onSwitchLoader,
          t,
        })}
      />
      <SettingsRow
        label={t('clientSettings.loader.minecraftVersion')}
        right={
          <span className="select-text text-eyebrow font-medium tabular-nums text-glass/70">
            {spec.minecraftVersion || '-'}
          </span>
        }
      />
      {loaderVersion && (
        <SettingsRow
          label={t('clientSettings.loader.version')}
          right={
            <span className="select-text text-eyebrow font-medium tabular-nums text-glass/70">
              {loaderVersion}
            </span>
          }
        />
      )}
    </SettingsGroup>
  );
};

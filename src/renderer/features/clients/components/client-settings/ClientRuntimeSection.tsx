import { openPath } from '@renderer/features/settings';
import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import type { ClientRuntimeRef } from '@shared/contracts/settings';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ClientRuntimeSectionProps = {
  runtime: ClientRuntimeRef;
};

export const ClientRuntimeSection = ({ runtime }: ClientRuntimeSectionProps) => {
  const { t } = useTranslation();

  return (
    <SettingsGroup title={t('clientSettings.runtime.title')}>
      <SettingsRow
        label={t('clientSettings.runtime.component')}
        description={t('clientSettings.runtime.componentDesc')}
        right={
          <span className="select-text text-eyebrow font-medium tabular-nums text-glass/70">
            {runtime.component}
          </span>
        }
      />
      <SettingsRow
        label={t('clientSettings.runtime.path')}
        description={
          <span
            className="block max-w-full select-text truncate font-mono text-microlabel text-glass/60"
            title={runtime.path}
            dir="rtl"
          >
            {runtime.path}
          </span>
        }
        right={
          <Button variant="outline" size="sm" onClick={() => void openPath(runtime.path)}>
            <FolderOpen className="size-3.5" strokeWidth={2} />
            {t('clientSettings.openFolder')}
          </Button>
        }
      />
    </SettingsGroup>
  );
};

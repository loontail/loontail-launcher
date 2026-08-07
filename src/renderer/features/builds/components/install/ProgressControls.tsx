import { useCancelBundle, usePauseBundle, useResumeBundle } from '@renderer/features/bundle';
import { useCancelInstall, usePauseInstall, useResumeInstall } from '@renderer/features/minecraft';
import type { CatalogKey } from '@shared/contracts/ids';
import { Pause, Play, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionButton } from './ActionButton';
import type { ProgressControlsKind } from './installSteps';

type ControlButtonsProps = {
  key: CatalogKey;
  paused: boolean;
  pausable: boolean;
  onPause: (key: CatalogKey) => Promise<unknown>;
  onResume: (key: CatalogKey) => Promise<unknown>;
  onCancel: (key: CatalogKey) => Promise<unknown>;
};

const ControlButtons = ({
  key,
  paused,
  pausable,
  onPause,
  onResume,
  onCancel,
}: ControlButtonsProps) => {
  const { t } = useTranslation();

  return (
    <>
      {paused ? (
        <ActionButton variant="ghost" onClick={() => void onResume(key)}>
          <Play size={12} />
          {t('builds.resume')}
        </ActionButton>
      ) : (
        // Pause disabled for a launch-time sync; pausing it would freeze Play.
        <ActionButton variant="ghost" disabled={!pausable} onClick={() => void onPause(key)}>
          <Pause size={12} />
          {t('builds.pause')}
        </ActionButton>
      )}
      <ActionButton variant="danger" onClick={() => void onCancel(key)}>
        <X size={12} />
        {t('builds.cancel')}
      </ActionButton>
    </>
  );
};

type ControlsProps = { key: CatalogKey; paused: boolean; pausable: boolean };

const InstallControls = ({ key, paused, pausable }: ControlsProps) => {
  const pause = usePauseInstall();
  const resume = useResumeInstall();
  const cancel = useCancelInstall();

  return (
    <ControlButtons
      key={key}
      paused={paused}
      pausable={pausable}
      onPause={pause.mutateAsync}
      onResume={resume.mutateAsync}
      onCancel={cancel.mutateAsync}
    />
  );
};

const BundleControls = ({ key, paused, pausable }: ControlsProps) => {
  const pause = usePauseBundle();
  const resume = useResumeBundle();
  const cancel = useCancelBundle();

  return (
    <ControlButtons
      key={key}
      paused={paused}
      pausable={pausable}
      onPause={pause.mutateAsync}
      onResume={resume.mutateAsync}
      onCancel={cancel.mutateAsync}
    />
  );
};

type ProgressControlsProps = {
  kind: ProgressControlsKind;
  paused: boolean;
  pausable: boolean;
  key: CatalogKey;
};

export const ProgressControls = ({ kind, paused, pausable, key }: ProgressControlsProps) => {
  if (kind === 'install') return <InstallControls key={key} paused={paused} pausable={pausable} />;
  if (kind === 'bundle') return <BundleControls key={key} paused={paused} pausable={pausable} />;
  return null;
};

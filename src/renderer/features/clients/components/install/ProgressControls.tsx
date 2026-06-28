import { useCancelBundle, usePauseBundle, useResumeBundle } from '@renderer/features/bundle';
import { useCancelInstall, usePauseInstall, useResumeInstall } from '@renderer/features/minecraft';
import type { CatalogKey } from '@shared/contracts/ids';
import { Pause, Play, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionButton } from './ActionButton';
import type { ProgressControlsKind } from './installSteps';

type ControlButtonsProps = {
  slug: CatalogKey;
  paused: boolean;
  pausable: boolean;
  onPause: (slug: CatalogKey) => Promise<unknown>;
  onResume: (slug: CatalogKey) => Promise<unknown>;
  onCancel: (slug: CatalogKey) => Promise<unknown>;
};

const ControlButtons = ({
  slug,
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
        <ActionButton variant="ghost" onClick={() => void onResume(slug)}>
          <Play size={12} />
          {t('clients.resume')}
        </ActionButton>
      ) : (
        // Pausing a launch-time (forLaunch) bundle sync parks it and would freeze
        // the Play flow, so the Pause control is disabled for it — the user can
        // still Cancel (BUG-2).
        <ActionButton variant="ghost" disabled={!pausable} onClick={() => void onPause(slug)}>
          <Pause size={12} />
          {t('clients.pause')}
        </ActionButton>
      )}
      <ActionButton variant="danger" onClick={() => void onCancel(slug)}>
        <X size={12} />
        {t('clients.cancel')}
      </ActionButton>
    </>
  );
};

type ControlsProps = { slug: CatalogKey; paused: boolean; pausable: boolean };

const InstallControls = ({ slug, paused, pausable }: ControlsProps) => {
  const pause = usePauseInstall();
  const resume = useResumeInstall();
  const cancel = useCancelInstall();

  return (
    <ControlButtons
      slug={slug}
      paused={paused}
      pausable={pausable}
      onPause={pause.mutateAsync}
      onResume={resume.mutateAsync}
      onCancel={cancel.mutateAsync}
    />
  );
};

const BundleControls = ({ slug, paused, pausable }: ControlsProps) => {
  const pause = usePauseBundle();
  const resume = useResumeBundle();
  const cancel = useCancelBundle();

  return (
    <ControlButtons
      slug={slug}
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
  slug: CatalogKey;
};

export const ProgressControls = ({ kind, paused, pausable, slug }: ProgressControlsProps) => {
  if (kind === 'install')
    return <InstallControls slug={slug} paused={paused} pausable={pausable} />;
  if (kind === 'bundle') return <BundleControls slug={slug} paused={paused} pausable={pausable} />;
  return null;
};

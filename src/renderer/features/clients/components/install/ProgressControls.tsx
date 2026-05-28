import { useCancelBundle, usePauseBundle, useResumeBundle } from '@renderer/features/bundle';
import { useCancelInstall, usePauseInstall, useResumeInstall } from '@renderer/features/minecraft';
import type { ClientSlug } from '@shared/contracts/ids';
import { Pause, Play, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionButton } from './ActionButton';
import type { ProgressControlsKind } from './installSteps';

type ControlButtonsProps = {
  slug: ClientSlug;
  paused: boolean;
  onPause: (slug: ClientSlug) => Promise<unknown>;
  onResume: (slug: ClientSlug) => Promise<unknown>;
  onCancel: (slug: ClientSlug) => Promise<unknown>;
};

const ControlButtons = ({ slug, paused, onPause, onResume, onCancel }: ControlButtonsProps) => {
  const { t } = useTranslation();

  return (
    <>
      {paused ? (
        <ActionButton variant="ghost" onClick={() => void onResume(slug)}>
          <Play size={12} />
          {t('clients.resume')}
        </ActionButton>
      ) : (
        <ActionButton variant="ghost" onClick={() => void onPause(slug)}>
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

const InstallControls = ({ slug, paused }: { slug: ClientSlug; paused: boolean }) => {
  const pause = usePauseInstall();
  const resume = useResumeInstall();
  const cancel = useCancelInstall();

  return (
    <ControlButtons
      slug={slug}
      paused={paused}
      onPause={pause.mutateAsync}
      onResume={resume.mutateAsync}
      onCancel={cancel.mutateAsync}
    />
  );
};

const BundleControls = ({ slug, paused }: { slug: ClientSlug; paused: boolean }) => {
  const pause = usePauseBundle();
  const resume = useResumeBundle();
  const cancel = useCancelBundle();

  return (
    <ControlButtons
      slug={slug}
      paused={paused}
      onPause={pause.mutateAsync}
      onResume={resume.mutateAsync}
      onCancel={cancel.mutateAsync}
    />
  );
};

type ProgressControlsProps = {
  kind: ProgressControlsKind;
  paused: boolean;
  slug: ClientSlug;
};

export const ProgressControls = ({ kind, paused, slug }: ProgressControlsProps) => {
  if (kind === 'install') return <InstallControls slug={slug} paused={paused} />;
  if (kind === 'bundle') return <BundleControls slug={slug} paused={paused} />;
  return null;
};

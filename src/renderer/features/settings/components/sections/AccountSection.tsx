import { useCurrentUser, useLogout } from '@renderer/features/auth';
import { SkinViewerCard, useSkinEditor } from '@renderer/features/skin';
import { cn } from '@renderer/shared/lib/cn';
import { Button } from '@renderer/shared/ui/Button';
import { CapeUploadIcon } from '@renderer/shared/ui/icons/CapeUploadIcon';
import { SkinUploadIcon } from '@renderer/shared/ui/icons/SkinUploadIcon';
import type { AuthProvider } from '@shared/contracts/auth';
import { Check, Copy, Loader2, LogOut, RotateCcw, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const VIEWER_WIDTH = 200;
const VIEWER_HEIGHT = 280;
const COPY_FEEDBACK_MS = 1500;

// Compact one-card account view — header / body / footer all in a single
// border. Sized to fit in the Settings viewport without scrolling.
//   • Header: PLAYER eyebrow + provider chip
//   • Body: viewer (left) + identity column (username + copy + spec list
//           + logout pinned to bottom-right)
//   • Footer: action toolbar (Upload skin / Upload cape / Reset icon)
//
// Email and password are intentionally absent — neither the Strapi nor
// the Mojang session has anything meaningful to display in those slots.
export const AccountSection = () => {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const editor = useSkinEditor();
  const { submit: logout, isPending: isLoggingOut } = useLogout();

  const provider = user?.provider ?? null;
  const username = user?.username ?? null;
  const showCape = provider !== 'mojang';
  const viewerCapeUrl = showCape ? editor.previewCapeUrl : undefined;

  const skinSpec =
    provider === 'mojang'
      ? t('settings.account.specSkinMojang')
      : t('settings.account.specSkinStrapi');
  const capeSpec = t('settings.account.specCapeStrapi');
  const helper =
    provider === 'mojang' ? t('settings.account.helperMojang') : t('settings.account.helperStrapi');

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <input {...editor.skinInputProps} />
      <input {...editor.capeInputProps} />

      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-muted-foreground">
          {t('settings.account.heroEyebrow')}
        </span>
        {provider && <ProviderChip provider={provider} />}
      </div>

      <div className="flex items-stretch gap-5 p-5">
        <Suspense
          fallback={
            <div
              className="flex shrink-0 items-center justify-center rounded-md border border-border bg-background"
              style={{ width: VIEWER_WIDTH, height: VIEWER_HEIGHT }}
            >
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <SkinViewerCard
            width={VIEWER_WIDTH}
            height={VIEWER_HEIGHT}
            skinUrl={editor.previewSkinUrl}
            capeUrl={viewerCapeUrl}
            className="bg-background"
          />
        </Suspense>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1
              className="selectable min-w-0 truncate text-2xl font-semibold leading-tight text-foreground"
              title={username ?? undefined}
            >
              {username ?? '—'}
            </h1>
            {username !== null && <CopyUsernameButton username={username} />}
          </div>

          <dl className="flex flex-col gap-1.5 rounded-md border border-edge bg-surface/40 px-3 py-2 text-xs">
            <SpecRow term={t('settings.account.skinLabel')} value={skinSpec} />
            {showCape && <SpecRow term={t('settings.account.capeLabel')} value={capeSpec} />}
          </dl>

          <p className="text-xs leading-relaxed text-muted-foreground">{helper}</p>

          <div className="mt-auto flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void logout()}
              disabled={isLoggingOut}
              className="gap-1.5 whitespace-nowrap"
            >
              {isLoggingOut ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogOut className="size-3.5" />
              )}
              {t('settings.launcher.logOut')}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background/40 px-5 py-3">
        {editor.hasPending ? (
          <PendingToolbar editor={editor} />
        ) : (
          <IdleToolbar editor={editor} showCape={showCape} />
        )}
      </div>
    </section>
  );
};

type SpecRowProps = { term: string; value: string };

const SpecRow = ({ term, value }: SpecRowProps) => (
  <div className="flex items-baseline gap-3">
    <dt className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-eyebrow text-muted-foreground">
      {term}
    </dt>
    <dd className="min-w-0 truncate text-foreground" title={value}>
      {value}
    </dd>
  </div>
);

type ToolbarProps = { editor: ReturnType<typeof useSkinEditor> };

// Reset is rendered icon-only with title/aria-label so the row stays on a
// single line even with the longest localised Upload label ("Завантажити
// скін / плащ"). Reset's `ml-auto` keeps it right-aligned.
const IdleToolbar = ({ editor, showCape }: ToolbarProps & { showCape: boolean }) => {
  const { t } = useTranslation();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={editor.pickSkin}
        disabled={editor.isBusy}
        className="gap-1.5 whitespace-nowrap"
      >
        <SkinUploadIcon className="size-4" />
        {t('settings.account.uploadSkin')}
      </Button>
      {showCape && (
        <Button
          variant="outline"
          size="sm"
          onClick={editor.pickCape}
          disabled={editor.isBusy}
          className="gap-1.5 whitespace-nowrap"
        >
          <CapeUploadIcon className="size-4" />
          {t('settings.account.uploadCape')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void editor.resetAll()}
        disabled={editor.isBusy || !editor.canReset}
        className="ml-auto gap-1.5 whitespace-nowrap"
        title={t('settings.account.resetToDefault')}
      >
        <RotateCcw className="size-3.5" />
        {t('settings.account.reset')}
      </Button>
    </>
  );
};

const PendingToolbar = ({ editor }: ToolbarProps) => {
  const { t } = useTranslation();
  return (
    <>
      <span className="mr-auto text-xs text-muted-foreground">
        {t('settings.account.unsavedHint')}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={editor.cancelAll}
        disabled={editor.isSaving}
        className="gap-1.5 whitespace-nowrap"
      >
        <X className="size-3.5" />
        {t('settings.account.cancel')}
      </Button>
      <Button
        size="sm"
        onClick={() => void editor.saveAll()}
        disabled={editor.isSaving}
        className="gap-1.5 whitespace-nowrap"
      >
        {editor.isSaving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        {t('settings.account.save')}
      </Button>
    </>
  );
};

type CopyUsernameButtonProps = { username: string };

const CopyUsernameButton = ({ username }: CopyUsernameButtonProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(username);
      setCopied(true);
    } catch {
      // Clipboard write can fail (permissions, no DOM focus); swallowing
      // keeps the UI calm — the truncated h1 is still selectable.
    }
  };

  const ariaLabel = copied
    ? t('settings.account.usernameCopied')
    : t('settings.account.copyUsername');

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors',
        'hover:bg-ghost-hover hover:text-foreground',
        copied && 'border-success/40 bg-success/10 text-success',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
      )}
      title={ariaLabel}
      aria-label={ariaLabel}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
};

type ProviderChipProps = { provider: AuthProvider };

const ProviderChip = ({ provider }: ProviderChipProps) => {
  const { t } = useTranslation();
  const label =
    provider === 'mojang'
      ? t('settings.account.providerMojang')
      : t('settings.account.providerStrapi');
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-eyebrow',
        provider === 'mojang'
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-border bg-muted text-foreground',
      )}
    >
      <span
        className={cn(
          'inline-block size-1.5 rounded-full',
          provider === 'mojang' ? 'bg-success' : 'bg-foreground/60',
        )}
      />
      {label}
    </span>
  );
};

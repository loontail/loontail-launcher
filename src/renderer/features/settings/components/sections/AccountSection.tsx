import { useCurrentUser, useLogout } from '@renderer/features/auth';
import { useSkinEditor } from '@renderer/features/skin';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { useTranslation } from 'react-i18next';
import { AccountIdentity, type AccountProviderChip } from './account/AccountIdentity';
import { AccountSkinPreview } from './account/AccountSkinPreview';
import { AccountIdleToolbar, AccountPendingToolbar } from './account/AccountToolbar';

export const AccountSection = () => {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const editor = useSkinEditor();
  const { submit: logout, isPending: isLoggingOut } = useLogout();

  const provider = user?.provider ?? null;
  const username = user?.username ?? null;
  const showCape = provider !== 'mojang';
  const viewerCapeUrl = showCape ? editor.previewCapeUrl : undefined;
  let providerChip: AccountProviderChip | null = null;

  if (provider !== null) {
    providerChip = {
      provider,
      label:
        provider === 'mojang'
          ? t('settings.account.providerMojang')
          : t('settings.account.providerStrapi'),
    };
  }

  const skinSpec =
    provider === 'mojang'
      ? t('settings.account.specSkinMojang')
      : t('settings.account.specSkinStrapi');
  const capeSpec = showCape ? t('settings.account.specCapeStrapi') : null;
  const helper =
    provider === 'mojang' ? t('settings.account.helperMojang') : t('settings.account.helperStrapi');
  const handleLogout = () => void logout();
  const handleReset = () => void editor.resetAll();
  const handleSave = () => void editor.saveAll();

  return (
    <SettingsGroup
      title={t('settings.account.heroEyebrow')}
      bodyClassName="flex items-stretch gap-5 p-4"
      footerClassName="flex flex-wrap items-center gap-2 border-t border-border bg-background/40 px-4 py-3"
      footer={
        editor.hasPending ? (
          <AccountPendingToolbar
            isSaving={editor.isSaving}
            onCancel={editor.cancelAll}
            onSave={handleSave}
          />
        ) : (
          <AccountIdleToolbar
            showCape={showCape}
            isBusy={editor.isBusy}
            canReset={editor.canReset}
            onPickSkin={editor.pickSkin}
            onPickCape={editor.pickCape}
            onReset={handleReset}
          />
        )
      }
    >
      <input {...editor.skinInputProps} />
      <input {...editor.capeInputProps} />

      <AccountSkinPreview skinUrl={editor.previewSkinUrl} capeUrl={viewerCapeUrl} />
      <AccountIdentity
        username={username}
        providerChip={providerChip}
        specs={{
          skinLabel: t('settings.account.skinLabel'),
          skin: skinSpec,
          capeLabel: t('settings.account.capeLabel'),
          cape: capeSpec,
        }}
        helper={helper}
        labels={{
          copyUsername: t('settings.account.copyUsername'),
          usernameCopied: t('settings.account.usernameCopied'),
          logout: t('settings.launcher.logOut'),
        }}
        logoutAction={{
          isPending: isLoggingOut,
          onClick: handleLogout,
        }}
      />
    </SettingsGroup>
  );
};

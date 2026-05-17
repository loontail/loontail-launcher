import { useCurrentUser, useLogout } from '@renderer/features/auth';
import { SkinEditor } from '@renderer/features/skin';
import { Button } from '@renderer/shared/ui/Button';
import { SettingsGroup } from '@renderer/shared/ui/SettingsGroup';
import { SettingsRow } from '@renderer/shared/ui/SettingsRow';
import { Loader2, LogOut } from 'lucide-react';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';

const SKIN_VIEWER_WIDTH = 170;

export const AccountSection = () => {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const { submit: logoutSubmit, isPending: isLoggingOut } = useLogout();

  return (
    <div className="flex gap-4">
      <div className="shrink-0">
        <Suspense
          fallback={
            <div
              className="flex items-center justify-center"
              style={{ width: SKIN_VIEWER_WIDTH, height: SKIN_VIEWER_WIDTH * 1.8 }}
            >
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <SkinEditor width={SKIN_VIEWER_WIDTH} />
        </Suspense>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <SettingsGroup title={t('settings.account.profile')}>
          <SettingsRow
            label={t('settings.account.username')}
            right={
              <span className="truncate text-sm font-medium text-foreground">
                {user?.username ?? '—'}
              </span>
            }
          />
          <SettingsRow
            label={t('settings.account.email')}
            right={
              <span className="truncate text-sm text-muted-foreground" title={user?.email}>
                {user?.email ?? '—'}
              </span>
            }
          />
          <SettingsRow
            label={t('settings.account.password')}
            right={<span className="text-sm tracking-widest text-muted-foreground">••••••••</span>}
          />
        </SettingsGroup>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => void logoutSubmit()}
          disabled={isLoggingOut}
          className="self-end gap-2"
        >
          {isLoggingOut ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <LogOut className="size-4" />
              {t('settings.launcher.logOut')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

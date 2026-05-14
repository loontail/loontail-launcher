import { useCurrentUser, useLogout } from '@renderer/features/auth';
import { SkinEditor } from '@renderer/features/skin';
import { Button } from '@renderer/shared/ui/Button';
import { Loader2, LogOut } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Group } from '../Group';
import { Row } from '../Row';

const SKIN_VIEWER_WIDTH = 170;

export const AccountSection = (): ReactElement => {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const { submit: logoutSubmit, isPending: isLoggingOut } = useLogout();

  return (
    <div className="flex gap-4">
      <div className="shrink-0">
        <SkinEditor width={SKIN_VIEWER_WIDTH} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Group title={t('settings.account.profile')}>
          <Row
            label={t('settings.account.username')}
            right={
              <span className="truncate text-sm font-medium text-foreground">
                {user?.username ?? '—'}
              </span>
            }
          />
          <Row
            label={t('settings.account.email')}
            right={
              <span className="truncate text-sm text-muted-foreground" title={user?.email}>
                {user?.email ?? '—'}
              </span>
            }
          />
          <Row
            label={t('settings.account.password')}
            right={<span className="text-sm tracking-widest text-muted-foreground">••••••••</span>}
          />
        </Group>

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

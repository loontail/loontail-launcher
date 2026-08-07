import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import { LOGIN_ERROR_CODE, type LoginErrorCode } from '@shared/contracts';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogin, useMojangLogin } from '../hooks';

const ERROR_COPY_KEYS: Record<LoginErrorCode, string> = {
  [LOGIN_ERROR_CODE.INVALID_CREDENTIALS]: 'auth.errorInvalid',
  [LOGIN_ERROR_CODE.NETWORK_ERROR]: 'auth.errorNetwork',
  [LOGIN_ERROR_CODE.RATE_LIMITED]: 'auth.errorRateLimited',
  [LOGIN_ERROR_CODE.BROWSER_OPEN_FAILED]: 'auth.errorBrowserOpen',
  // Never shown (Cancelled is suppressed upstream); entry exists to keep the record total.
  [LOGIN_ERROR_CODE.CANCELLED]: 'auth.errorUnknown',
  [LOGIN_ERROR_CODE.UNKNOWN]: 'auth.errorUnknown',
};

export const LoginForm = () => {
  const { t } = useTranslation();
  const { submit, isPending, errorCode, clearError } = useLogin();
  const mojang = useMojangLogin();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Drop any stale Microsoft-flow error so only the active flow's error shows.
    mojang.clearError();
    await submit({ identifier, password });
  };

  const isCredentialsDisabled = isPending || identifier.length === 0 || password.length === 0;
  const isMojangBusy = mojang.isPending;
  const displayedError = errorCode ?? mojang.errorCode;

  return (
    <div className="flex h-full items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-edge bg-surface-1 p-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-text-hi">{t('auth.signIn')}</h1>
          <p className="text-xs text-text-mute">{t('auth.description')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="login-identifier" className="text-xs font-medium text-text-hi">
            {t('auth.identifier')}
          </label>
          <Input
            id="login-identifier"
            autoFocus
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            disabled={isPending || isMojangBusy}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="login-password" className="text-xs font-medium text-text-hi">
            {t('auth.password')}
          </label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isPending || isMojangBusy}
          />
        </div>

        {displayedError !== null && displayedError !== undefined && (
          <p className="text-xs text-destructive">{t(ERROR_COPY_KEYS[displayedError])}</p>
        )}

        <Button type="submit" disabled={isCredentialsDisabled || isMojangBusy} className="w-full">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : t('auth.submit')}
        </Button>

        <div className="flex items-center gap-3 text-microlabel uppercase tracking-widest text-text-mute">
          <span className="h-px flex-1 bg-edge" />
          {t('auth.or')}
          <span className="h-px flex-1 bg-edge" />
        </div>

        {isMojangBusy ? (
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" disabled className="w-full gap-2">
              <Loader2 className="size-4 animate-spin" />
              {t('auth.microsoft.waiting')}
            </Button>
            <button
              type="button"
              onClick={() => mojang.cancel()}
              className="self-center text-xs text-text-mute underline hover:text-text-hi"
            >
              {t('auth.microsoft.cancel')}
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              clearError();
              void mojang.signIn();
            }}
            className="w-full gap-2"
          >
            {t('auth.signInWithMicrosoft')}
          </Button>
        )}
      </form>
    </div>
  );
};

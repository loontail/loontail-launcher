import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import { LOGIN_ERROR_CODE, type LoginErrorCode } from '@shared/contracts';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogin } from '../hooks';

const ERROR_COPY_KEYS: Record<LoginErrorCode, string> = {
  [LOGIN_ERROR_CODE.InvalidCredentials]: 'auth.errorInvalid',
  [LOGIN_ERROR_CODE.NetworkError]: 'auth.errorNetwork',
  [LOGIN_ERROR_CODE.RateLimited]: 'auth.errorRateLimited',
  [LOGIN_ERROR_CODE.Unknown]: 'auth.errorUnknown',
};

export const LoginForm = () => {
  const { t } = useTranslation();
  const { submit, isPending } = useLogin();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errorCode, setErrorCode] = useState<LoginErrorCode | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorCode(null);
    const result = await submit({ identifier, password });
    if (!result.ok) {
      setErrorCode(result.error);
    }
  };

  const isDisabled = isPending || identifier.length === 0 || password.length === 0;

  return (
    <div className="flex h-full items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-card-foreground">{t('auth.signIn')}</h1>
          <p className="text-xs text-muted-foreground">{t('auth.description')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="login-identifier" className="text-xs font-medium text-foreground">
            {t('auth.identifier')}
          </label>
          <Input
            id="login-identifier"
            autoFocus
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            disabled={isPending}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="login-password" className="text-xs font-medium text-foreground">
            {t('auth.password')}
          </label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isPending}
          />
        </div>

        {errorCode !== null && (
          <p className="text-xs text-destructive">{t(ERROR_COPY_KEYS[errorCode])}</p>
        )}

        <Button type="submit" disabled={isDisabled} className="w-full">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : t('auth.submit')}
        </Button>
      </form>
    </div>
  );
};

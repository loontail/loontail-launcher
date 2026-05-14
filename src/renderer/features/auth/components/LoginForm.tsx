import { Button } from '@renderer/shared/ui/Button';
import { Input } from '@renderer/shared/ui/Input';
import type { LoginErrorCode } from '@shared/contracts';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useLogin } from '../hooks';

const ERROR_COPY: Record<LoginErrorCode, string> = {
  INVALID_CREDENTIALS: 'Invalid login or password.',
  NETWORK_ERROR: 'Could not reach the server. Check your connection.',
  RATE_LIMITED: 'Too many sign-in attempts. Please wait a minute and try again.',
  UNKNOWN: 'Something went wrong. Try again later.',
};

export const LoginForm = () => {
  const { submit, isPending } = useLogin();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const result = await submit({ identifier, password });
    if (!result.ok) {
      setError(ERROR_COPY[result.error]);
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
          <h1 className="text-lg font-semibold text-card-foreground">Sign in</h1>
          <p className="text-xs text-muted-foreground">
            Use your Loontail account to launch the game.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="login-identifier" className="text-xs font-medium text-foreground">
            Username or email
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
            Password
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

        {error !== null && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" disabled={isDisabled} className="w-full">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Sign in'}
        </Button>
      </form>
    </div>
  );
};

import { AppBar } from '@renderer/features/app-bar';
import { LoginForm, useCurrentUser } from '@renderer/features/auth';
import { SettingsPage } from '@renderer/features/settings';
import {
  useCanGoBack,
  useCurrentView,
  useNavigationStore,
} from '@renderer/shared/lib/stores/navigation';
import { Button } from '@renderer/shared/ui/Button';
import { IPC_CHANNELS } from '@shared/ipc';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Settings } from 'lucide-react';

const hasCustomTitleBar = window.api.platform !== 'linux';

const VersionLine = () => {
  const versionQuery = useQuery({
    queryKey: ['app', 'version'],
    queryFn: () => window.api.invoke(IPC_CHANNELS.appGetVersion, undefined),
  });
  return (
    <p className="text-xs text-muted-foreground">
      {versionQuery.isPending ? 'Loading…' : `version ${versionQuery.data ?? 'unknown'}`}
    </p>
  );
};

const NavigationButton = () => {
  const canGoBack = useCanGoBack();
  const push = useNavigationStore((state) => state.push);
  const pop = useNavigationStore((state) => state.pop);

  const handleClick = () => {
    if (canGoBack) {
      pop();
    } else {
      push('settings');
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      aria-label={canGoBack ? 'Back' : 'Open settings'}
      className="h-full w-[46px] rounded-none px-0"
    >
      {canGoBack ? (
        <ArrowLeft className="size-3.5" strokeWidth={1.5} />
      ) : (
        <Settings className="size-3.5" strokeWidth={1.5} />
      )}
    </Button>
  );
};

type HomeViewProps = {
  username: string;
};

const HomeView = ({ username }: HomeViewProps) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3">
    <h1 className="text-2xl font-bold">Welcome, {username}</h1>
    <VersionLine />
  </div>
);

export const App = () => {
  const { user, isPending } = useCurrentUser();
  const view = useCurrentView();
  const isAuthenticated = !isPending && user !== null && user !== undefined;

  return (
    <div className="flex h-full flex-col">
      {hasCustomTitleBar && <AppBar actions={isAuthenticated ? <NavigationButton /> : null} />}
      <main className="flex flex-1 flex-col overflow-hidden">
        {isPending && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isPending && user === null && <LoginForm />}
        {isAuthenticated && view === 'home' && <HomeView username={user.username} />}
        {isAuthenticated && view === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
};

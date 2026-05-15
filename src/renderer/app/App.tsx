import { AppBar } from '@renderer/features/app-bar';
import { LoginForm, useCurrentUser } from '@renderer/features/auth';
import { ClientsPage } from '@renderer/features/clients';
import { SettingsPage } from '@renderer/features/settings';
import { cn } from '@renderer/shared/lib/cn';
import {
  useCanGoBack,
  useCurrentView,
  useNavigationStore,
} from '@renderer/shared/lib/stores/navigation';
import { ArrowLeft, Loader2, Settings } from 'lucide-react';

const hasCustomTitleBar = window.api.platform !== 'linux';

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
    <button
      type="button"
      onClick={handleClick}
      aria-label={canGoBack ? 'Back' : 'Open settings'}
      className={cn(
        'flex h-full w-10 cursor-pointer items-center justify-center transition-colors hover:bg-glass/10 hover:text-glass',
        canGoBack ? 'text-glass/80' : 'text-glass/45',
      )}
    >
      {canGoBack ? <ArrowLeft className="size-3.5" /> : <Settings className="size-3.5" />}
    </button>
  );
};

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
        {isAuthenticated && view === 'home' && <ClientsPage />}
        {isAuthenticated && view === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
};

import { AppBar } from '@renderer/features/app-bar';
import { LoginForm, useCurrentUser } from '@renderer/features/auth';
import { ClientsPage } from '@renderer/features/clients';
import { MinecraftEventsListener } from '@renderer/features/minecraft';
import { NotificationsListener } from '@renderer/features/notifications';
import { SettingsPage } from '@renderer/features/settings';
import { UpdaterAutoCheck, UpdaterEventsListener } from '@renderer/features/updater';
import { cn } from '@renderer/shared/lib/cn';
import {
  Views,
  useCanGoBack,
  useCurrentView,
  useNavigationStore,
} from '@renderer/shared/lib/stores/navigation';
import { ToastContainer } from '@renderer/shared/ui/Toast';
import { ArrowLeft, Loader2, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const hasCustomTitleBar = window.api.platform !== 'linux';

const NavigationButton = () => {
  const { t } = useTranslation();
  const canGoBack = useCanGoBack();
  const push = useNavigationStore((state) => state.push);
  const pop = useNavigationStore((state) => state.pop);

  const handleClick = () => {
    if (canGoBack) {
      pop();
    } else {
      push(Views.SETTINGS);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t(canGoBack ? 'navigation.back' : 'navigation.openSettings')}
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
      <MinecraftEventsListener />
      <UpdaterEventsListener />
      <UpdaterAutoCheck />
      <NotificationsListener />
      {hasCustomTitleBar && <AppBar actions={isAuthenticated ? <NavigationButton /> : null} />}
      <main className="flex flex-1 flex-col overflow-hidden">
        {isPending && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isPending && user === null && <LoginForm />}
        {isAuthenticated && view === Views.HOME && <ClientsPage />}
        {isAuthenticated && view === Views.SETTINGS && <SettingsPage />}
      </main>
      <ToastContainer />
    </div>
  );
};

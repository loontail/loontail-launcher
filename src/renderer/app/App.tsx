import { AppBar } from '@renderer/features/app-bar';
import { LoginForm, useCurrentUser } from '@renderer/features/auth';
import { BundleEventsListener } from '@renderer/features/bundle';
import { ClientsPage } from '@renderer/features/clients';
import { MinecraftEventsListener } from '@renderer/features/minecraft';
import { NotificationsListener } from '@renderer/features/notifications';
import { SetupPage, useNeedsSetup } from '@renderer/features/setup';
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
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';

const hasCustomTitleBar = window.api.platform !== 'linux';
const SettingsPage = lazy(() =>
  import('@renderer/features/settings').then((module) => ({ default: module.SettingsPage })),
);

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
  const { user, isPending: isAuthPending, isError: isAuthError } = useCurrentUser();
  const { needsSetup, isPending: isSetupPending } = useNeedsSetup();
  const view = useCurrentView();
  const isAuthenticated = !isAuthPending && user !== null && user !== undefined;
  const isBootstrapping = isSetupPending || (!needsSetup && isAuthPending);
  // A failed auth check (main not ready, IPC error) leaves `user` undefined, not
  // null — fall back to the login screen so the user can retry instead of facing
  // a blank main area.
  const isSignedOut = user === null || isAuthError;

  return (
    <div className="flex h-full flex-col">
      <MinecraftEventsListener />
      <BundleEventsListener />
      <UpdaterEventsListener />
      <UpdaterAutoCheck />
      <NotificationsListener />
      {hasCustomTitleBar && (
        <AppBar actions={!needsSetup && isAuthenticated ? <NavigationButton /> : null} />
      )}
      <main className="flex flex-1 flex-col overflow-hidden">
        {isBootstrapping && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isBootstrapping && needsSetup && <SetupPage />}
        {!isBootstrapping && !needsSetup && isSignedOut && <LoginForm />}
        {!isBootstrapping && !needsSetup && isAuthenticated && view === Views.HOME && (
          <ClientsPage />
        )}
        {!isBootstrapping && !needsSetup && isAuthenticated && view === Views.SETTINGS && (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <SettingsPage />
          </Suspense>
        )}
      </main>
      <ToastContainer />
    </div>
  );
};

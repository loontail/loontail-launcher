import { AppShell, TitleBar } from '@renderer/features/app-shell';
import { LoginForm, useCurrentUser } from '@renderer/features/auth';
import { BundleEventsListener } from '@renderer/features/bundle';
import { MinecraftEventsListener } from '@renderer/features/minecraft';
import { NotificationsListener } from '@renderer/features/notifications';
import { SetupPage, useNeedsSetup } from '@renderer/features/setup';
import { UpdaterAutoCheck, UpdaterEventsListener } from '@renderer/features/updater';
import { ToastContainer } from '@renderer/shared/ui/Toast';
import { Loader2 } from 'lucide-react';

const hasCustomTitleBar = window.api.platform !== 'linux';

export const App = () => {
  const { user, isPending: isAuthPending, isError: isAuthError } = useCurrentUser();
  const { needsSetup, isPending: isSetupPending } = useNeedsSetup();
  const isAuthenticated = !isAuthPending && user !== null && user !== undefined;
  const isBootstrapping = isSetupPending || (!needsSetup && isAuthPending);
  // A failed auth check (main not ready, IPC error) leaves `user` undefined, not
  // null — fall back to the login screen so the user can retry instead of facing
  // a blank main area.
  const isSignedOut = user === null || isAuthError;
  const showShell = !isBootstrapping && !needsSetup && isAuthenticated;

  return (
    <div className="flex h-full flex-col">
      <MinecraftEventsListener />
      <BundleEventsListener />
      <UpdaterEventsListener />
      <UpdaterAutoCheck />
      <NotificationsListener />
      {showShell ? (
        <AppShell showTitleBar={hasCustomTitleBar} />
      ) : (
        <div className="flex h-full flex-col">
          {hasCustomTitleBar && <TitleBar />}
          <main className="flex flex-1 flex-col overflow-hidden">
            {isBootstrapping && (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-text-mute" />
              </div>
            )}
            {!isBootstrapping && needsSetup && <SetupPage />}
            {!isBootstrapping && !needsSetup && isSignedOut && <LoginForm />}
          </main>
        </div>
      )}
      <ToastContainer />
    </div>
  );
};

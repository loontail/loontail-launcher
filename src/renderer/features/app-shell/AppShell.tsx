import { useCatalog } from '@renderer/features/catalog';
import { BuildDetailPage, BuildsHomePage } from '@renderer/features/clients';
import { HomePage } from '@renderer/features/home';
import {
  useCanGoBack,
  useCurrentRoute,
  useNavigationStore,
} from '@renderer/shared/lib/stores/navigation';
import type { CatalogKey } from '@shared/contracts/ids';
import { Loader2 } from 'lucide-react';
import { Suspense, lazy, useEffect } from 'react';
import { TopNav } from './TopNav';

const SettingsPage = lazy(() =>
  import('@renderer/features/settings').then((module) => ({ default: module.SettingsPage })),
);

const useGlobalBack = () => {
  const pop = useNavigationStore((s) => s.pop);
  const canGoBack = useCanGoBack();

  useEffect(() => {
    if (!canGoBack) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') pop();
    };
    // Mouse "back" thumb button reports as button index 3 on mouseup.
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        pop();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [canGoBack, pop]);
};

const BuildRoute = ({ routeKey }: { routeKey: CatalogKey }) => {
  const { items, isFetching } = useCatalog();
  const pop = useNavigationStore((s) => s.pop);
  const item = items.find((candidate) => candidate.key === routeKey);

  // The build vanished (deleted, or the catalog refetched it away). Don't crash —
  // fall back to the catalog once the data has settled. Waiting for any in-flight
  // fetch also covers a just-created build that hasn't landed in the list yet.
  useEffect(() => {
    if (!isFetching && !item) pop();
  }, [isFetching, item, pop]);

  if (!item) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-text-mute" />
      </div>
    );
  }
  // Key by build so navigating build→build (Continue card / Recently strip)
  // remounts the page — resetting the active tab to About and scroll to top
  // rather than reusing the previous build's instance.
  return <BuildDetailPage key={item.key} item={item} onBack={pop} />;
};

const RouteContent = () => {
  const route = useCurrentRoute();
  if (route.name === 'settings') {
    return (
      <div className="h-full overflow-y-auto pt-12">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-text-mute" />
            </div>
          }
        >
          <SettingsPage />
        </Suspense>
      </div>
    );
  }
  if (route.name === 'build') {
    return <BuildRoute routeKey={route.key} />;
  }
  if (route.name === 'builds') {
    return <BuildsHomePage />;
  }
  return <HomePage />;
};

type AppShellProps = {
  showTitleBar: boolean;
};

export const AppShell = ({ showTitleBar }: AppShellProps) => {
  const route = useCurrentRoute();
  useGlobalBack();

  return (
    <div className="relative h-full overflow-hidden">
      <TopNav customTitleBar={showTitleBar} />
      <main key={route.name} className="h-full overflow-hidden motion-safe:animate-route-fade">
        <RouteContent />
      </main>
    </div>
  );
};

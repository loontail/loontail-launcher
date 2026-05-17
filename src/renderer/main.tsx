import '@fontsource/nunito/400.css';
import '@fontsource/nunito/500.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './index.css';
import './i18n';

import { App } from '@renderer/app/App';
import { ErrorBoundary } from '@renderer/app/ErrorBoundary';
import { i18n } from '@renderer/i18n';
import { createQueryClient } from '@renderer/shared/lib/queryClient';
import { persistOptions } from '@renderer/shared/lib/queryPersister';
import { QUERY_KEY_ROOTS } from '@shared/constants';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Root element not found');
}

const queryClient = createQueryClient();

// Localized Strapi fields (title, description, media) are cached per-locale by
// query key; drop the previous locale's entries so the UI doesn't briefly show
// stale text/images while the new locale fetches in the background.
i18n.on('languageChanged', () => {
  void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ROOTS.clients] });
});

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-md text-center text-sm text-muted-foreground">{error.message}</p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-edge-md px-4 py-2 text-sm hover:bg-ghost-hover"
          >
            Try again
          </button>
        </div>
      )}
    >
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <App />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

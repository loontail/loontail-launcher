import '@fontsource/nunito/400.css';
import '@fontsource/nunito/500.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './index.css';
import './i18n';

import { App } from '@renderer/app/App';
import { ErrorBoundary } from '@renderer/app/ErrorBoundary';
import { ErrorFallback } from '@renderer/app/ErrorFallback';
import { i18n } from '@renderer/i18n';
import { evictInactiveLocaleQueries } from '@renderer/shared/lib/localeQueryCache';
import { createQueryClient } from '@renderer/shared/lib/queryClient';
import { persistOptions } from '@renderer/shared/lib/queryPersister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Root element not found');
}

const queryClient = createQueryClient();

i18n.on('languageChanged', (next) => {
  evictInactiveLocaleQueries(queryClient, next);
});

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary fallback={({ error, reset }) => <ErrorFallback error={error} reset={reset} />}>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <App />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

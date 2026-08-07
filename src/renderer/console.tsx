import '@fontsource/nunito/400.css';
import '@fontsource/nunito/500.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './index.css';
import './console/styles.css';
import './i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsoleApp } from './console/App';
import { ConsoleErrorBoundary } from './console/ConsoleErrorBoundary';

const rootElement = document.getElementById('console-root');
if (rootElement === null) {
  throw new Error('Console root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ConsoleErrorBoundary>
      <ConsoleApp />
    </ConsoleErrorBoundary>
  </StrictMode>,
);

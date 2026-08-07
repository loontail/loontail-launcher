import { ErrorBoundary } from '@renderer/app/ErrorBoundary';
import { ErrorFallback, ErrorFallbackAction } from '@renderer/app/ErrorFallback';
import type { ReactNode } from 'react';
import { clear } from './api';

export const ConsoleErrorBoundary = ({ children }: { children: ReactNode }) => (
  <ErrorBoundary
    fallback={({ error, reset }) => (
      <ErrorFallback error={error} reset={reset}>
        {/* Retry alone cannot recover from a poisoned log line, so offer the buffer clear too. */}
        <ErrorFallbackAction
          onClick={() => {
            void clear().catch(() => {
              // Nothing left to fall back on here: the fallback is already the
              // error surface, and retry re-mounts against the same buffer.
            });
            reset();
          }}
        >
          Clear log
        </ErrorFallbackAction>
      </ErrorFallback>
    )}
  >
    {children}
  </ErrorBoundary>
);

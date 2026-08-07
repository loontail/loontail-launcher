import type { ReactNode } from 'react';

const ACTION_CLASS =
  'cursor-pointer rounded-md border border-edge-md px-4 py-2 text-sm hover:bg-ghost-hover';

export const ErrorFallbackAction = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) => (
  <button type="button" onClick={onClick} className={ACTION_CLASS}>
    {children}
  </button>
);

type ErrorFallbackProps = {
  error: Error;
  reset: () => void;
  children?: ReactNode;
};

// Copy stays untranslated: i18n itself may be the thing that threw.
export const ErrorFallback = ({ error, reset, children }: ErrorFallbackProps) => (
  <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas p-8 text-text-hi">
    <h1 className="text-lg font-semibold">Something went wrong</h1>
    <p className="max-w-md text-center text-sm text-text-mute">{error.message}</p>
    <div className="flex items-center gap-2">
      <ErrorFallbackAction onClick={reset}>Try again</ErrorFallbackAction>
      {children}
    </div>
  </div>
);

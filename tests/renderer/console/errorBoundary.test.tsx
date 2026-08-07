// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clear = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@renderer/console/api', () => ({ clear }));

const { ConsoleErrorBoundary } = await import('@renderer/console/ConsoleErrorBoundary');

const Boom = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error('log line exploded');
  return <p>console body</p>;
};

// The boundary keeps rendering the failed child until something changes, so the
// retry path needs a child whose throwing-ness can be flipped from the outside.
const Harness = () => {
  const [shouldThrow, setShouldThrow] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShouldThrow(false)}>
        fix it
      </button>
      <ConsoleErrorBoundary>
        <Boom shouldThrow={shouldThrow} />
      </ConsoleErrorBoundary>
    </>
  );
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clear.mockClear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ConsoleErrorBoundary', () => {
  it('shows the fallback with the error message instead of a blank window', () => {
    render(
      <ConsoleErrorBoundary>
        <Boom shouldThrow />
      </ConsoleErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('log line exploded')).toBeDefined();
  });

  it('re-renders the child when retry is pressed after the cause is gone', () => {
    render(<Harness />);
    expect(screen.getByText('Something went wrong')).toBeDefined();

    fireEvent.click(screen.getByText('fix it'));
    fireEvent.click(screen.getByText('Try again'));

    expect(screen.getByText('console body')).toBeDefined();
  });

  it('offers a buffer clear for a poisoned log line', () => {
    render(
      <ConsoleErrorBoundary>
        <Boom shouldThrow />
      </ConsoleErrorBoundary>,
    );

    fireEvent.click(screen.getByText('Clear log'));

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('handles a rejected buffer clear instead of floating the promise', async () => {
    const rejected = Promise.reject(new Error('ipc/console-clear-failed'));
    const catchSpy = vi.spyOn(rejected, 'catch');
    clear.mockReturnValueOnce(rejected);

    render(
      <ConsoleErrorBoundary>
        <Boom shouldThrow />
      </ConsoleErrorBoundary>,
    );

    fireEvent.click(screen.getByText('Clear log'));

    expect(catchSpy).toHaveBeenCalledTimes(1);
    await expect(rejected.catch((error: Error) => error.message)).resolves.toBe(
      'ipc/console-clear-failed',
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('logs the failure so the console window leaves a breadcrumb', () => {
    render(
      <ConsoleErrorBoundary>
        <Boom shouldThrow />
      </ConsoleErrorBoundary>,
    );

    expect(consoleError).toHaveBeenCalledWith('[renderer] uncaught error', expect.anything());
  });
});

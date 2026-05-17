import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
};

type State = { error: Error | null };

// React error boundaries can only be implemented as classes. Keeps the rest
// of the app crash-isolated: a render-time exception below this boundary
// shows the fallback instead of a white screen.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // biome-ignore lint/suspicious/noConsole: last-resort logger — main's logger isn't reachable from the renderer
    console.error('[renderer] uncaught error', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}

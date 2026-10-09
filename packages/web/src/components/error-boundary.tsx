/**
 * The top-level error boundary.
 *
 * A render crash in a dashboard widget should not blank the whole application and
 * lose the user's place. The boundary offers a reload rather than a dead end,
 * because there is no server-side rendering to fall back on and the database is
 * local: a reload is recoverable, a blank page with a console message is not.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced rather than swallowed: a silent catch here is how a bug report
    // becomes "it just went blank sometimes".
    console.error('Unhandled render error', error, info.componentStack);
  }

  private readonly reload = (): void => {
    this.setState({ error: null });
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The application stopped rendering. Your data is safe in the local database; reloading
          usually clears this.
        </p>
        <pre className="max-w-2xl overflow-x-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
          {error.message}
        </pre>
        <Button onClick={this.reload}>Reload</Button>
      </div>
    );
  }
}

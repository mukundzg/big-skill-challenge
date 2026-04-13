import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message || 'Unknown error' };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error('[admin-web] render error', err, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="shell shell-auth">
          <p className="err">Something went wrong in the UI.</p>
          <p className="muted">{this.state.message}</p>
          <button type="button" className="btn primary" onClick={() => this.setState({ hasError: false, message: '' })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Sentry } from "../sentry";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(error);
    Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-500"
            aria-hidden="true"
          >
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
              Something went wrong
            </h1>
            <p style={{ color: "var(--text-mute)" }}>An unexpected error occurred. Try again, or reload the page.</p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={this.resetErrorBoundary}
              className="rounded-lg border border-claw-500 px-4 py-2 text-claw-text"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-claw-500 px-4 py-2 text-claw-on"
            >
              Reload
            </button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <pre
              className="mt-4 max-w-xl overflow-auto rounded-lg bg-black/5 p-4 text-left text-xs"
              style={{ color: "var(--text-mute)" }}
            >
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

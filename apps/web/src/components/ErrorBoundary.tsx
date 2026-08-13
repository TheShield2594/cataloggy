import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { captureException } from "../sentry";
import { SECTION_TITLE } from "./typography";

/**
 * Which of the two boundaries this is.
 *
 * `app` wraps the whole tree in main.tsx and is the last line of defence, so
 * its fallback owns the viewport — there is nothing left beside it to sit next
 * to. `page` wraps the routed page inside the shell: the header, sidebar and
 * tab bar are still rendered and still work, so the fallback is one panel in
 * the content column and the user can navigate away from the broken view.
 */
type ErrorBoundaryVariant = "app" | "page";

type ErrorBoundaryProps = { children: ReactNode; variant?: ErrorBoundaryVariant };
type ErrorBoundaryState = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(error);
    captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
  }

  // The children unmounted when the fallback took their place, so clearing the
  // flag builds them again from scratch — component state, effects and requests
  // included. That is the whole of what a retry can do here: an error that is a
  // deterministic function of the route will throw again, which is why the page
  // boundary keeps the shell's navigation on screen behind this button rather
  // than making Try Again the only way out.
  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const isPage = this.props.variant === "page";
      return (
        <div
          // The page fallback replaces one route, not the window, so it takes
          // the height it needs inside the content column instead of a
          // viewport's worth. Either way it is an error the user did not ask
          // for and did not see coming, so it announces itself.
          role="alert"
          className={
            isPage
              ? "flex w-full flex-col items-center justify-center gap-4 rounded-2xl px-6 py-20 text-center"
              : "flex min-h-screen w-full flex-col items-center justify-center gap-4 px-6 text-center"
          }
          style={isPage ? { border: "1px solid var(--border)", background: "var(--bg-1)" } : undefined}
        >
          {/* .status-chip--bad rather than a raw red ramp: text, fill and
              hairline all mix out of --status-bad, so this reads the same on
              all five themes. See the note above those tokens in index.css. */}
          <div
            className="status-chip status-chip--bad flex h-14 w-14 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h1 className={SECTION_TITLE} style={{ color: "var(--text)" }}>
              Something went wrong
            </h1>
            <p style={{ color: "var(--text-mute)" }}>
              {isPage
                ? "This page failed to load. Try again, or pick another from the menu."
                : "An unexpected error occurred. Try again, or reload the page."}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={this.resetErrorBoundary}
              className="btn-secondary"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-primary"
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

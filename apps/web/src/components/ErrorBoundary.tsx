import { Component, type ReactNode } from "react";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 px-6 text-center">
          <p style={{ color: "var(--text-mute)" }}>Something went wrong.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-claw-500 px-4 py-2 text-white"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

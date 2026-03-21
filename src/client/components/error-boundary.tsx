import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-8 text-center">
          <h2 className="text-zinc-100">Something went wrong</h2>
          <p className="text-sm text-zinc-500">{this.state.error?.message}</p>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl bg-accent-500/15 px-4 py-2 text-sm font-medium text-accent-300 transition-colors hover:bg-accent-500/25"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = "/app/projects";
            }}
          >
            Go to projects
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

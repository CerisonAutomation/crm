"use client";
/**
 * Global error boundary — catches unhandled React errors and displays a
 * user-friendly fallback instead of crashing the whole app.
 *
 * Without this, a single runtime error in any component would unmount the
 * entire React tree and leave the user with a blank page. This boundary
 * catches those errors, logs them for debugging, and offers a recovery path.
 */
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console for debugging — in production this would go to an
    // error tracking service (Sentry, etc.)
    console.error("[error-boundary] caught an error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className="min-h-screen flex items-center justify-center bg-background p-4"
          data-testid="error-boundary-fallback"
          role="alert"
        >
          <div className="max-w-md w-full text-center space-y-6">
            <div className="mx-auto h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-cobble-ink">
                Something went wrong
              </h1>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. Please try again or contact support if the problem persists.
              </p>
            </div>
            {this.state.error && (
              <div className="rounded-md bg-muted p-3 text-left">
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex items-center justify-center gap-3">
              <Button onClick={this.handleReset} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try again
              </Button>
              <Button
                onClick={() => {
                  // Deliberate full document load, not a client transition:
                  // this subtree just threw, so we want a fresh app shell
                  // rather than re-entering the state that crashed it.
                  window.location.assign(new URL("/", window.location.origin).href);
                }}
              >
                Return Home
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

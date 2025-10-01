import type React from "react";

import { AlertCircle } from "lucide-react";
import { Component, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { captureErrorGlobal } from "../utils/error-tracking";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  error: Error | null;
  errorInfo: null | React.ErrorInfo;
  hasError: boolean;
}

/**
 * Error boundary component for catching and displaying errors in the calendar.
 * Wraps the calendar component to prevent crashes from propagating to the entire app.
 * @example
 * ```tsx
 * <CalendarErrorBoundary>
 *   <NewCalendar {...props} />
 * </CalendarErrorBoundary>
 * ```
 */
export class CalendarErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      error: null,
      errorInfo: null,
      hasError: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      error,
      hasError: true,
    };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to error tracking service
    captureErrorGlobal(error, {
      componentStack: errorInfo.componentStack,
      context: "CalendarErrorBoundary",
    });

    // Update state with error info
    this.setState({
      errorInfo,
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleReload = (): void => {
    globalThis.location.reload();
  };

  handleReset = (): void => {
    this.setState({
      error: null,
      errorInfo: null,
      hasError: false,
    });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <Card className="m-4">
          <CardContent className="flex items-center justify-center min-h-96 p-6">
            <div className="max-w-md w-full space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Fehler beim Laden des Kalenders</AlertTitle>
                <AlertDescription>
                  Es ist ein unerwarteter Fehler aufgetreten. Bitte versuchen
                  Sie es erneut.
                </AlertDescription>
              </Alert>

              {import.meta.env.DEV && this.state.error && (
                <div className="p-4 bg-muted rounded-md">
                  <p className="text-sm font-mono text-destructive mb-2">
                    {this.state.error.name}: {this.state.error.message}
                  </p>
                  {this.state.error.stack && (
                    <details className="text-xs font-mono text-muted-foreground">
                      <summary className="cursor-pointer hover:text-foreground">
                        Stack Trace
                      </summary>
                      <pre className="mt-2 overflow-auto max-h-48 p-2 bg-background rounded">
                        {this.state.error.stack}
                      </pre>
                    </details>
                  )}
                  {this.state.errorInfo?.componentStack && (
                    <details className="text-xs font-mono text-muted-foreground mt-2">
                      <summary className="cursor-pointer hover:text-foreground">
                        Component Stack
                      </summary>
                      <pre className="mt-2 overflow-auto max-h-48 p-2 bg-background rounded">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={this.handleReset} variant="outline">
                  Erneut versuchen
                </Button>
                <Button onClick={this.handleReload}>Seite neu laden</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

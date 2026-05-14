export function captureErrorGlobal(
  error: unknown,
  context?: Record<string, unknown>,
) {
  // Skip error tracking in development unless explicitly enabled for testing
  if (import.meta.env.DEV && !import.meta.env["VITE_ENABLE_POSTHOG_IN_DEV"]) {
    console.error("Error (PostHog disabled in dev):", error, context);
    return;
  }

  // Convert error to Error instance if needed
  const errorInstance =
    error instanceof Error ? error : new Error(String(error));

  // Access PostHog from global if available
  const posthog = (
    globalThis as {
      posthog?: {
        captureException: (
          error: Error,
          context?: Record<string, unknown>,
        ) => void;
      };
    }
  ).posthog;

  if (posthog) {
    posthog.captureException(errorInstance, context);
  } else {
    // Fallback to console if PostHog is not available
    console.error("Error (PostHog not available):", error, context);
  }
}

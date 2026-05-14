// src/utils/error-tracking.ts

import { usePostHog } from "posthog-js/react";
import { useCallback } from "react";

export { captureErrorGlobal } from "./error-tracking-global";

/**
 * Utility for error tracking with PostHog.
 */

/**
 * Hook to get PostHog error reporting function.
 * Returns a function that captures exceptions with context.
 */
export function useErrorTracking() {
  const posthog = usePostHog();

  const captureError = useCallback(
    (error: unknown, context?: Record<string, unknown>) => {
      // Skip error tracking in development unless explicitly enabled for testing
      if (
        import.meta.env.DEV &&
        !import.meta.env["VITE_ENABLE_POSTHOG_IN_DEV"]
      ) {
        console.error("Error (PostHog disabled in dev):", error, context);
        return;
      }

      // Convert error to Error instance if needed
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));

      posthog.captureException(errorInstance, context);
    },
    [posthog],
  );

  return { captureError };
}

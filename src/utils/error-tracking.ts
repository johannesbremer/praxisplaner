// src/utils/error-tracking.ts

import { usePostHog } from "@posthog/react";
import { useCallback } from "react";

import {
  type SafeErrorContext,
  sanitizeErrorContext,
} from "./error-tracking-global";

export {
  buildGdtFileDiagnostics,
  captureErrorGlobal,
  type SafeErrorContext,
} from "./error-tracking-global";

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
    (error: unknown, context?: SafeErrorContext) => {
      const safeContext = sanitizeErrorContext(context);
      // Skip error tracking in development unless explicitly enabled for testing
      if (
        import.meta.env.DEV &&
        !import.meta.env["VITE_ENABLE_POSTHOG_IN_DEV"]
      ) {
        console.error("Error (PostHog disabled in dev):", error, safeContext);
        return;
      }

      // Convert error to Error instance if needed
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));

      posthog.captureException(errorInstance, safeContext);
    },
    [posthog],
  );

  return { captureError };
}

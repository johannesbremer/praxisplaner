// src/utils/error-tracking.ts

import { usePostHog } from "posthog-js/react";
import { useCallback } from "react";

/**
 * Utility for error tracking with PostHog.
 * All errors are now automatically collected before being thrown.
 */

/**
 * Hook to get PostHog error reporting function.
 * Returns a function that captures exceptions with context.
 */
export function useErrorTracking() {
  const posthog = usePostHog();

  const captureError = useCallback(
    (error: unknown, context?: Record<string, unknown>) => {
      // Convert error to Error instance if needed
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));

      posthog.captureException(errorInstance, context);
    },
    [posthog],
  );

  const captureAndThrow = useCallback(
    (error: unknown, context?: Record<string, unknown>): never => {
      captureError(error, context);
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      throw errorInstance;
    },
    [captureError],
  );

  const createAndThrow = useCallback(
    (message: string, context?: Record<string, unknown>): never => {
      return captureAndThrow(new Error(message), context);
    },
    [captureAndThrow],
  );

  return { captureAndThrow, captureError, createAndThrow };
}

/**
 * Non-hook utility for capturing errors when usePostHog is not available
 * (e.g., outside of React components).
 */
export function captureErrorGlobal(
  error: unknown,
  context?: Record<string, unknown>,
) {
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

/**
 * Captures error and throws it. ALWAYS use this instead of direct throw.
 */
export function captureAndThrow(
  error: unknown,
  context?: Record<string, unknown>,
): never {
  const errorInstance =
    error instanceof Error ? error : new Error(String(error));

  // Always capture error in browser environment
  captureErrorGlobal(errorInstance, context);

  throw errorInstance;
}

/**
 * Creates and throws an error with tracking. Use instead of `throw new Error()`.
 */
export function createAndThrow(
  message: string,
  context?: Record<string, unknown>,
): never {
  return captureAndThrow(new Error(message), context);
}

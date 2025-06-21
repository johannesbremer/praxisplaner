// src/utils/error-tracking.ts

import { usePostHog } from "posthog-js/react";
import { useCallback } from "react";

/**
 * Utility for error tracking with PostHog.
 */

/**
 * Enhanced context collection utilities
 */
function getBrowserInfo() {
  if (typeof navigator === "undefined") {
    return {};
  }
  
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
  };
}

function getEnvironmentInfo() {
  return {
    isSecureContext: globalThis.isSecureContext,
    location: typeof location !== "undefined" ? location.href : undefined,
    timestamp: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

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

      // Enhance context with browser and environment info
      const enhancedContext = {
        ...context,
        browser: getBrowserInfo(),
        environment: getEnvironmentInfo(),
      };

      posthog.captureException(errorInstance, enhancedContext);
    },
    [posthog],
  );

  return { captureError };
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

  // Enhance context with browser and environment info
  const enhancedContext = {
    ...context,
    browser: getBrowserInfo(),
    environment: getEnvironmentInfo(),
  };

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
    posthog.captureException(errorInstance, enhancedContext);
  } else {
    // Fallback to console if PostHog is not available
    console.error("Error (PostHog not available):", error, enhancedContext);
  }
}

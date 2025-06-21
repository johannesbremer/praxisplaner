// src/tests/error-tracking.test.ts

import { beforeEach, describe, expect, test, vi } from "vitest";

import { captureErrorGlobal } from "../utils/error-tracking";

// Mock PostHog
const mockCaptureException = vi.fn();
const mockPostHog = {
  captureException: mockCaptureException,
};

type GlobalWithPostHog = typeof globalThis & {
  location?: {
    href: string;
  };
  navigator?: {
    cookieEnabled: boolean;
    language: string;
    onLine: boolean;
    userAgent: string;
    userAgentData?: {
      platform: string;
    };
  };
  posthog?: {
    captureException: (error: Error, context?: Record<string, unknown>) => void;
  };
  window?: object;
};

describe("Error Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset globalThis
    delete (globalThis as GlobalWithPostHog).posthog;

    // Mock browser APIs for testing
    Object.defineProperty(globalThis, "window", {
      value: {},
      writable: true,
    });

    Object.defineProperty(globalThis, "navigator", {
      value: {
        cookieEnabled: true,
        language: "en-US",
        onLine: true,
        userAgent: "Mozilla/5.0 (Test Browser)",
        userAgentData: {
          platform: "Linux",
        },
      },
      writable: true,
    });

    Object.defineProperty(globalThis, "location", {
      value: {
        href: "https://test.example.com",
      },
      writable: true,
    });
  });

  describe("captureErrorGlobal", () => {
    test("should capture Error instances with PostHog when available and include enhanced context", () => {
      // Setup global PostHog
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Test error message");
      const context = { errorType: "test", fileName: "test.gdt" };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          ...context,
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );

      // Verify enhanced context structure
      const capturedContext = mockCaptureException.mock.calls[0]?.[1] as
        | Record<string, unknown>
        | undefined;
      expect(capturedContext?.["browser"]).toEqual(
        expect.objectContaining({
          cookieEnabled: expect.any(Boolean),
          language: expect.any(String),
          onLine: expect.any(Boolean),
          platform: expect.any(String),
          userAgent: expect.any(String),
        }),
      );
      expect(capturedContext?.["environment"]).toEqual(
        expect.objectContaining({
          timestamp: expect.any(String),
          timezone: expect.any(String),
        }),
      );
    });

    test("should convert non-Error to Error and capture with enhanced context", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const errorString = "String error message";
      const context = { context: "test context" };

      captureErrorGlobal(errorString, context);

      expect(mockCaptureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          ...context,
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );
      const capturedError = mockCaptureException.mock.calls[0]?.[0] as Error;
      expect(capturedError.message).toBe("String error message");
    });

    test("should fallback to console.error when PostHog not available", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
        // Console error fallback implementation
      });

      const error = new Error("Test error");
      const context = { test: "context" };

      captureErrorGlobal(error, context);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Error (PostHog not available):",
        error,
        expect.objectContaining({
          ...context,
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );
      expect(mockCaptureException).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test("should handle undefined context with enhanced context", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Test error");

      captureErrorGlobal(error);

      expect(mockCaptureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );
    });
  });

  describe("Context validation", () => {
    test("should handle GDT file processing context with comprehensive details", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("GDT parsing failed");
      const context = {
        context: "GDT parsing error",
        directoryName: "GDT_Directory",
        errorType: "gdt_parsing",
        fileContent: "8000013601..\n8100004Patient123", // Full content now
        fileLastModified: "2025-06-21T10:00:00.000Z",
        fileName: "patient123.gdt",
        fileSize: 1024,
        fileType: "text/plain",
        gdtFields: 10,
        isDOMException: false,
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          ...context,
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );
      const capturedContext = mockCaptureException.mock.calls[0]?.[1];
      expect(capturedContext).toMatchObject({
        context: "GDT parsing error",
        directoryName: "GDT_Directory",
        errorType: "gdt_parsing",
        fileContent: "8000013601..\n8100004Patient123", // Validates full content is captured
        fileName: "patient123.gdt",
        fileSize: 1024,
      });
    });

    test("should handle FileSystem API context with enhanced permission details", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new DOMException("Access denied", "NotAllowedError");
      const context = {
        context: "Error requesting permission",
        currentPermissionState: "prompt",
        domExceptionName: "NotAllowedError",
        errorType: "file_system_permission",
        handleName: String.raw`C:\GDT`,
        isDOMException: true,
        loggingContext: "initial load",
        operationType: "request",
        permissionMode: "readwrite",
        withRequest: true,
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          ...context,
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );
    });
  });

  describe("Error types coverage", () => {
    test("should handle all major error types from the application with enhanced context", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const errorTypes = [
        "gdt_parsing",
        "file_processing",
        "file_system_permission",
        "file_system_observer",
        "file_system_observer_setup",
        "browser_compatibility",
        "browser_api",
        "configuration",
        "mutation",
        "router_error_boundary",
        "indexeddb_storage",
        "indexeddb_loading",
      ];

      for (const errorType of errorTypes) {
        const error = new Error(`Test ${errorType} error`);
        captureErrorGlobal(error, { errorType });
      }

      expect(mockCaptureException).toHaveBeenCalledTimes(errorTypes.length);

      // Verify each call includes enhanced context
      for (const [i, errorType] of errorTypes.entries()) {
        const capturedContext = mockCaptureException.mock.calls[i]?.[1];
        expect(capturedContext).toEqual(
          expect.objectContaining({
            browser: expect.any(Object),
            environment: expect.any(Object),
            errorType,
          }),
        );
      }
    });

    test("should handle FileSystemObserver errors with detailed context", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Observer setup failed");
      const context = {
        context: "Error setting up FileSystemObserver",
        currentPermission: "granted",
        directoryName: "GDT_Directory",
        errorType: "file_system_observer_setup",
        isDOMException: false,
        isObserverSupported: false,
        observerConfig: { recursive: false },
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          ...context,
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );
    });

    test("should handle configuration errors with environment details", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error(
        "VITE_CONVEX_URL environment variable is required",
      );
      const context = {
        availableEnvVars: ["NODE_ENV", "VITE_PUBLIC_POSTHOG_KEY"],
        context: "Missing CONVEX_URL environment variable",
        envVarName: "VITE_CONVEX_URL",
        errorType: "configuration",
        nodeEnv: "development",
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          ...context,
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );
    });

    test("should handle mutation errors with detailed context", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Mutation failed");
      const context = {
        context: "React Query mutation error",
        errorName: "Error",
        errorType: "mutation",
        hasContext: false,
        mutationFn: "present",
        mutationKey: ["patients", "upsert"],
        networkError: false,
        variablesType: "object",
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          ...context,
          browser: expect.any(Object),
          environment: expect.any(Object),
        }),
      );
    });
  });
});

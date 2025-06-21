// src/tests/error-tracking.test.ts

import { beforeEach, describe, expect, test, vi } from "vitest";

import { captureErrorGlobal } from "../utils/error-tracking";

// Mock PostHog
const mockCaptureException = vi.fn();
const mockPostHog = {
  captureException: mockCaptureException,
};

type GlobalWithPostHog = typeof globalThis & {
  posthog?: {
    captureException: (error: Error, context?: Record<string, unknown>) => void;
  };
};

describe("Error Tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset globalThis
    delete (globalThis as GlobalWithPostHog).posthog;
  });

  describe("captureErrorGlobal", () => {
    test("should capture Error instances with PostHog when available and include enhanced context", () => {
      // Setup global PostHog
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Test error message");
      const context = { errorType: "test", fileName: "test.gdt" };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(error, expect.objectContaining({
        ...context,
        browser: expect.any(Object),
        environment: expect.any(Object),
      }));
      
      // Verify enhanced context structure
      const capturedContext = mockCaptureException.mock.calls[0]?.[1];
      expect(capturedContext?.browser).toEqual(expect.objectContaining({
        userAgent: expect.any(String),
        platform: expect.any(String),
        language: expect.any(String),
        cookieEnabled: expect.any(Boolean),
        onLine: expect.any(Boolean),
      }));
      expect(capturedContext?.environment).toEqual(expect.objectContaining({
        timestamp: expect.any(String),
        timezone: expect.any(String),
      }));
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

      expect(mockCaptureException).toHaveBeenCalledWith(error, expect.objectContaining({
        browser: expect.any(Object),
        environment: expect.any(Object),
      }));
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
        fileName: "patient123.gdt",
        fileSize: 1024,
        fileLastModified: "2025-06-21T10:00:00.000Z",
        fileType: "text/plain",
        gdtFields: 10,
        isDOMException: false,
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(error, expect.objectContaining({
        ...context,
        browser: expect.any(Object),
        environment: expect.any(Object),
      }));
      const capturedContext = mockCaptureException.mock.calls[0]?.[1];
      expect(capturedContext).toMatchObject({
        context: "GDT parsing error",
        errorType: "gdt_parsing",
        fileName: "patient123.gdt",
        directoryName: "GDT_Directory",
        fileSize: 1024,
        fileContent: "8000013601..\n8100004Patient123", // Validates full content is captured
      });
    });

    test("should handle FileSystem API context with enhanced permission details", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new DOMException("Access denied", "NotAllowedError");
      const context = {
        context: "Error requesting permission",
        errorType: "file_system_permission",
        domExceptionName: "NotAllowedError",
        handleName: String.raw`C:\GDT`,
        isDOMException: true,
        loggingContext: "initial load",
        operationType: "request",
        permissionMode: "readwrite",
        currentPermissionState: "prompt",
        withRequest: true,
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(error, expect.objectContaining({
        ...context,
        browser: expect.any(Object),
        environment: expect.any(Object),
      }));
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
      for (let i = 0; i < errorTypes.length; i++) {
        const capturedContext = mockCaptureException.mock.calls[i]?.[1];
        expect(capturedContext).toEqual(expect.objectContaining({
          errorType: errorTypes[i],
          browser: expect.any(Object),
          environment: expect.any(Object),
        }));
      }
    });

    test("should handle FileSystemObserver errors with detailed context", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Observer setup failed");
      const context = {
        context: "Error setting up FileSystemObserver",
        directoryName: "GDT_Directory",
        errorType: "file_system_observer_setup",
        currentPermission: "granted",
        isObserverSupported: false,
        observerConfig: { recursive: false },
        isDOMException: false,
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(error, expect.objectContaining({
        ...context,
        browser: expect.any(Object),
        environment: expect.any(Object),
      }));
    });

    test("should handle configuration errors with environment details", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("VITE_CONVEX_URL environment variable is required");
      const context = {
        context: "Missing CONVEX_URL environment variable",
        errorType: "configuration",
        envVarName: "VITE_CONVEX_URL",
        availableEnvVars: ["NODE_ENV", "VITE_PUBLIC_POSTHOG_KEY"],
        nodeEnv: "development",
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(error, expect.objectContaining({
        ...context,
        browser: expect.any(Object),
        environment: expect.any(Object),
      }));
    });

    test("should handle mutation errors with detailed context", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Mutation failed");
      const context = {
        context: "React Query mutation error",
        errorType: "mutation",
        mutationKey: ["patients", "upsert"],
        mutationFn: "present",
        variablesType: "object",
        hasContext: false,
        networkError: false,
        errorName: "Error",
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledWith(error, expect.objectContaining({
        ...context,
        browser: expect.any(Object),
        environment: expect.any(Object),
      }));
    });
  });
});

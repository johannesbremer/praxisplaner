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
    test("should capture Error instances with PostHog when available", () => {
      // Setup global PostHog
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Test error message");
      const context = { errorType: "test", fileName: "test.gdt" };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledExactlyOnceWith(
        error,
        context,
      );
    });

    test("should convert non-Error to Error and capture with PostHog", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const errorString = "String error message";
      const context = { context: "test context" };

      captureErrorGlobal(errorString, context);

      expect(mockCaptureException).toHaveBeenCalledExactlyOnceWith(
        expect.any(Error),
        context,
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

      expect(consoleSpy).toHaveBeenCalledExactlyOnceWith(
        "Error (PostHog not available):",
        error,
        context,
      );
      expect(mockCaptureException).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test("should handle undefined context", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("Test error");

      captureErrorGlobal(error);

      expect(mockCaptureException).toHaveBeenCalledTimes(1);
      const [firstArg, secondArg] = mockCaptureException.mock.calls[0] ?? [];
      expect(firstArg).toBe(error);
      expect(secondArg).toBeUndefined();
    });
  });

  describe("Context validation", () => {
    test("should handle GDT file processing context correctly", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new Error("GDT parsing failed");
      const context = {
        context: "GDT file processing error",
        errorType: "gdt_parsing",
        fileContent: "8000013601..\n8100004Patient123",
        fileName: "patient123.gdt",
      };

      captureErrorGlobal(error, context);

      expect(mockCaptureException).toHaveBeenCalledExactlyOnceWith(
        error,
        context,
      );
      const capturedContext = mockCaptureException.mock.calls[0]?.[1];
      expect(capturedContext).toMatchObject({
        context: "GDT file processing error",
        errorType: "gdt_parsing",
        fileName: "patient123.gdt",
      });
    });

    test("should handle FileSystem API context correctly", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const error = new DOMException("Access denied", "NotAllowedError");
      const context = {
        context: "Error requesting permission",
        domExceptionName: "NotAllowedError",
        handleName: String.raw`C:\GDT`,
        isDOMException: true,
        loggingContext: "initial load",
        operationType: "request",
      };

      captureErrorGlobal(error, context);

      // captureErrorGlobal converts DOMException to Error, so we expect an Error instance
      expect(mockCaptureException).toHaveBeenCalledExactlyOnceWith(
        expect.any(Error),
        context,
      );
      const capturedError = mockCaptureException.mock.calls[0]?.[0] as Error;
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError.message).toBe("NotAllowedError: Access denied");
    });
  });

  describe("Error types coverage", () => {
    test("should handle all major error types from the application", () => {
      (globalThis as GlobalWithPostHog).posthog = mockPostHog;

      const errorTypes = [
        "gdt_parsing",
        "file_processing",
        "file_system_observer",
        "file_system_observer_setup",
        "browser_compatibility",
        "browser_api",
        "configuration",
        "mutation",
        "router_error_boundary",
      ];

      for (const errorType of errorTypes) {
        const error = new Error(`Test ${errorType} error`);
        captureErrorGlobal(error, { errorType });
      }

      expect(mockCaptureException).toHaveBeenCalledTimes(errorTypes.length);
    });
  });
});

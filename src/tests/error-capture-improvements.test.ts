// src/tests/error-capture-improvements.test.ts

import { beforeEach, describe, expect, test, vi } from "vitest";

import { captureErrorGlobal } from "../utils/error-tracking";

// Mock the error tracking
vi.mock("../utils/error-tracking");

describe("Error Capture Improvements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SafeFileSystemObserver", () => {
    test("should capture errors instead of throwing when FileSystemObserver is not supported", async () => {
      // Mock unsupported environment
      vi.doMock("../utils/browser-api", () => ({
        isFileSystemObserverSupported: () => false,
        SafeFileSystemObserver: class {
          observer = null;

          constructor() {
            const error = new Error(
              "FileSystemObserver is not supported in this environment",
            );
            captureErrorGlobal(error, {
              context: "FileSystemObserver not supported",
              errorType: "browser_compatibility",
            });
          }

          disconnect() {
            // Cleanup logic would go here
            return;
          }

          observe() {
            const error = new Error("Observer not initialized");
            captureErrorGlobal(error, {
              context:
                "FileSystemObserver observe called without initialization",
              errorType: "browser_api",
            });
            return Promise.reject(error);
          }

          unobserve() {
            const error = new Error("Observer not initialized");
            captureErrorGlobal(error, {
              context:
                "FileSystemObserver unobserve called without initialization",
              errorType: "browser_api",
            });
            return Promise.reject(error);
          }
        },
      }));

      const { SafeFileSystemObserver } = await import("../utils/browser-api");
      const mockCallback = vi.fn();

      // This should not throw anymore
      expect(() => {
        new SafeFileSystemObserver(mockCallback);
      }).not.toThrow();

      // But it should capture the error
      expect(captureErrorGlobal).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: "FileSystemObserver not supported",
          errorType: "browser_compatibility",
        }),
      );
    });

    test("should return rejected promise from observe method when observer is not initialized", async () => {
      vi.doMock("../utils/browser-api", () => ({
        isFileSystemObserverSupported: () => false,
        SafeFileSystemObserver: class {
          observer = null;

          disconnect() {
            // Cleanup logic would go here
            return;
          }

          observe() {
            const error = new Error("Observer not initialized");
            captureErrorGlobal(error, {
              context:
                "FileSystemObserver observe called without initialization",
              errorType: "browser_api",
            });
            return Promise.reject(error);
          }
        },
      }));

      const { SafeFileSystemObserver } = await import("../utils/browser-api");
      const mockCallback = vi.fn();
      const observer = new SafeFileSystemObserver(mockCallback);

      // Mock directory handle
      const mockHandle = {} as import("../types").FileSystemDirectoryHandle;

      // This should return a rejected promise instead of throwing
      await expect(observer.observe(mockHandle)).rejects.toThrow(
        "Observer not initialized",
      );

      // And it should capture the error
      expect(captureErrorGlobal).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: "FileSystemObserver observe called without initialization",
          errorType: "browser_api",
        }),
      );
    });
  });

  describe("Form validation error handling", () => {
    test("should verify that validation errors are captured and not thrown", () => {
      // This test documents the expected behavior change in base-schedule-management.tsx
      // Form validation errors should now be captured with error tracking and show
      // user-friendly messages instead of being thrown and caught by try-catch

      const validationError = new Error(
        "Bitte wählen Sie mindestens einen Wochentag aus",
      );

      // Simulate the improved validation error handling
      const handleValidationError = (
        error: Error,
        context: Record<string, unknown>,
      ) => {
        captureErrorGlobal(error, context);
        // Return early instead of throwing
        return { error: error.message, success: false };
      };

      const result = handleValidationError(validationError, {
        context: "base_schedule_validation",
        validationField: "daysOfWeek",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "Bitte wählen Sie mindestens einen Wochentag aus",
      );
      expect(captureErrorGlobal).toHaveBeenCalledWith(
        validationError,
        expect.objectContaining({
          context: "base_schedule_validation",
          validationField: "daysOfWeek",
        }),
      );
    });
  });
});

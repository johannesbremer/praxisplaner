import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  FileSystemDirectoryHandle,
  FileSystemObserverOptions,
} from "../types";

import { SafeFileSystemObserver } from "../utils/browser-api";
import {
  browserApiError,
  captureFrontendError,
  invalidStateError,
} from "../utils/frontend-errors";

describe("Frontend error handling", () => {
  type FileSystemObserverConstructor = new (
    callback: (_records: readonly unknown[]) => Promise<void> | void,
  ) => {
    disconnect(): void;
    observe(
      handle: FileSystemDirectoryHandle,
      options?: FileSystemObserverOptions,
    ): Promise<void>;
    unobserve(handle: FileSystemDirectoryHandle): Promise<void>;
  };

  type MutableGlobals = typeof globalThis & {
    FileSystemObserver?: FileSystemObserverConstructor;
    posthog?: { captureException: ReturnType<typeof vi.fn> };
  };

  const mutableGlobalThis = globalThis as MutableGlobals;
  const originalFileSystemObserver = mutableGlobalThis.FileSystemObserver;
  const originalPosthog = mutableGlobalThis.posthog;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("VITE_ENABLE_POSTHOG_IN_DEV", "true");
    mutableGlobalThis.posthog = {
      captureException: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();

    if (originalFileSystemObserver) {
      mutableGlobalThis.FileSystemObserver = originalFileSystemObserver;
    } else {
      Reflect.deleteProperty(globalThis, "FileSystemObserver");
    }

    if (originalPosthog) {
      mutableGlobalThis.posthog = originalPosthog;
    } else {
      Reflect.deleteProperty(globalThis, "posthog");
    }
  });

  test("expected frontend errors are handled locally without reporting to PostHog", () => {
    captureFrontendError(
      browserApiError(
        "FileSystemObserver is not supported in this environment",
        "SafeFileSystemObserver.constructor",
      ),
      { context: "FileSystemObserver not supported" },
      "expected-browser-api-error",
    );

    expect(mutableGlobalThis.posthog?.captureException).not.toHaveBeenCalled();
  });

  test("unexpected frontend errors are reported to PostHog with structured metadata", () => {
    captureFrontendError(
      invalidStateError(
        "Broken schedule lineage snapshot",
        "base_schedule_created_payload",
      ),
      { context: "history_restore" },
      "unexpected-invalid-state-error",
    );

    expect(
      mutableGlobalThis.posthog?.captureException,
    ).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "Broken schedule lineage snapshot",
        name: "FrontendError:invalid_state",
      }),
      expect.objectContaining({
        context: "history_restore",
        frontendErrorKind: "invalid_state",
        frontendErrorMessage: "Broken schedule lineage snapshot",
        frontendErrorSource: "base_schedule_created_payload",
      }),
    );
  });

  test("unsupported FileSystemObserver returns an Err instead of building a half-initialized observer", () => {
    Reflect.deleteProperty(globalThis, "FileSystemObserver");
    const onChange = vi.fn();

    const observerResult = SafeFileSystemObserver.create(onChange);
    expect(observerResult.isErr()).toBe(true);
    expect(observerResult._unsafeUnwrapErr()).toMatchObject({
      expected: true,
      kind: "browser_api",
      message: "FileSystemObserver is not supported in this environment",
      source: "SafeFileSystemObserver.constructor",
    });

    expect(mutableGlobalThis.posthog?.captureException).not.toHaveBeenCalled();
  });

  test("observer failures are returned as frontend error values instead of rejected promises", async () => {
    class MockFileSystemObserver {
      disconnect() {
        return;
      }

      observe(
        handle: FileSystemDirectoryHandle,
        options?: FileSystemObserverOptions,
      ): Promise<void> {
        void handle;
        void options;
        return Promise.reject(new Error("Permission denied"));
      }

      unobserve(handle: FileSystemDirectoryHandle): Promise<void> {
        void handle;
        return Promise.reject(new Error("Permission denied"));
      }
    }

    (
      globalThis as typeof globalThis & {
        FileSystemObserver: typeof MockFileSystemObserver;
      }
    ).FileSystemObserver = MockFileSystemObserver;

    const observer = SafeFileSystemObserver.create(vi.fn())._unsafeUnwrap();
    const handle = {} as FileSystemDirectoryHandle;

    const observeResult = await observer.observe(handle);
    expect(observeResult.isErr()).toBe(true);
    expect(observeResult._unsafeUnwrapErr()).toMatchObject({
      kind: "browser_api",
      message: "Observer could not start observing the directory",
      source: "SafeFileSystemObserver.observe",
    });

    const unobserveResult = await observer.unobserve(handle);
    expect(unobserveResult.isErr()).toBe(true);
    expect(unobserveResult._unsafeUnwrapErr()).toMatchObject({
      kind: "browser_api",
      message: "Observer could not stop observing the directory",
      source: "SafeFileSystemObserver.unobserve",
    });
  });
});

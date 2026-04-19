// src/utils/browser-api.ts

import { errAsync, ResultAsync } from "neverthrow";

import type {
  FileSystemDirectoryHandle as AppFileSystemDirectoryHandle,
  FileSystemFileHandle as AppFileSystemFileHandle,
  FileSystemChangeRecord,
  FileSystemObserverOptions,
} from "../types";

import {
  browserApiError,
  captureFrontendError,
  frontendErrorFromUnknown,
} from "./frontend-errors";

/**
 * Utility functions for safely using browser APIs that may not be available in all environments.
 */

type FileSystemObserverCallback = (
  records: readonly FileSystemObserverRecord[],
) => Promise<void> | void;

type FileSystemObserverConstructor = new (
  callback: FileSystemObserverCallback,
) => FileSystemObserverInstance;

interface FileSystemObserverInstance {
  disconnect(): void;
  observe(
    handle: AppFileSystemDirectoryHandle,
    options?: { recursive?: boolean },
  ): Promise<void>;
  unobserve(handle: AppFileSystemDirectoryHandle): Promise<void>;
}

interface FileSystemObserverRecord {
  readonly changedHandle:
    | AppFileSystemDirectoryHandle
    | AppFileSystemFileHandle;
  readonly relativePathComponents: readonly string[];
  readonly type: "appeared" | "disappeared" | "modified";
}

function getFileSystemObserverConstructor(): FileSystemObserverConstructor | null {
  const candidate: unknown = Reflect.get(globalThis, "FileSystemObserver");
  return isFileSystemObserverConstructor(candidate) ? candidate : null;
}

function hasDirectoryPicker(
  value: typeof globalThis,
): value is typeof globalThis & {
  showDirectoryPicker: Window["showDirectoryPicker"];
} {
  return (
    "showDirectoryPicker" in value &&
    typeof Reflect.get(value, "showDirectoryPicker") === "function"
  );
}

function isFileSystemObserverConstructor(
  value: unknown,
): value is FileSystemObserverConstructor {
  return typeof value === "function";
}

/**
 * Safely creates and dispatches a CustomEvent if available.
 */
export function dispatchCustomEvent(
  eventType: string,
  detail: unknown,
  target: EventTarget = globalThis,
): boolean {
  // Check if we're in a browser environment
  if (typeof CustomEvent === "undefined") {
    return false;
  }

  try {
    const event = new CustomEvent(eventType, { detail });
    target.dispatchEvent(event);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if FileSystemObserver is available.
 */
export function isFileSystemObserverSupported(): boolean {
  return getFileSystemObserverConstructor() !== null;
}

/**
 * Check if we're in a secure context with File System Access API support.
 */
export function isFileSystemAccessSupported(): boolean {
  return globalThis.isSecureContext && hasDirectoryPicker(globalThis);
}

/**
 * Safely check if DOMException is available and if an error is a DOMException.
 */
export function isDOMException(error: unknown): error is DOMException {
  return typeof DOMException !== "undefined" && error instanceof DOMException;
}

/**
 * Typed wrapper for FileSystemObserver that handles browser compatibility.
 */
export class SafeFileSystemObserver {
  private observer: FileSystemObserverInstance | null = null;

  constructor(
    callback: (records: FileSystemChangeRecord[]) => Promise<void> | void,
  ) {
    const FileSystemObserverCtor = getFileSystemObserverConstructor();

    if (!FileSystemObserverCtor) {
      const error = browserApiError(
        "FileSystemObserver is not supported in this environment",
        "SafeFileSystemObserver.constructor",
      );
      captureFrontendError(error, {
        context: "FileSystemObserver not supported",
        errorType: "browser_compatibility",
      });
      // Set observer to null instead of throwing - let the methods handle the error state
      this.observer = null;
      return;
    }

    this.observer = new FileSystemObserverCtor(
      async (records: readonly FileSystemObserverRecord[]) => {
        // Convert records to our typed format
        const typedRecords: FileSystemChangeRecord[] = records.map(
          (record) => ({
            changedHandle: record.changedHandle,
            relativePathComponents: [...record.relativePathComponents],
            type: record.type,
          }),
        );

        await callback(typedRecords);
      },
    );
  }

  disconnect(): void {
    this.observer?.disconnect();
  }

  observe(
    handle: AppFileSystemDirectoryHandle,
    options?: FileSystemObserverOptions,
  ): ResultAsync<void, ReturnType<typeof browserApiError>> {
    if (!this.observer) {
      const error = browserApiError(
        "Observer not initialized",
        "SafeFileSystemObserver.observe",
      );
      captureFrontendError(error, {
        context: "FileSystemObserver observe called without initialization",
        errorType: "browser_api",
      });
      return errAsync(error);
    }
    return ResultAsync.fromPromise(
      this.observer.observe(handle, options),
      (error) =>
        frontendErrorFromUnknown(error, {
          expected: false,
          kind: "browser_api",
          message: "Observer could not start observing the directory",
          source: "SafeFileSystemObserver.observe",
        }),
    );
  }

  unobserve(
    handle: AppFileSystemDirectoryHandle,
  ): ResultAsync<void, ReturnType<typeof browserApiError>> {
    if (!this.observer) {
      const error = browserApiError(
        "Observer not initialized",
        "SafeFileSystemObserver.unobserve",
      );
      captureFrontendError(error, {
        context: "FileSystemObserver unobserve called without initialization",
        errorType: "browser_api",
      });
      return errAsync(error);
    }
    return ResultAsync.fromPromise(
      this.observer.unobserve(handle),
      (error) =>
        frontendErrorFromUnknown(error, {
          expected: false,
          kind: "browser_api",
          message: "Observer could not stop observing the directory",
          source: "SafeFileSystemObserver.unobserve",
        }),
    );
  }
}

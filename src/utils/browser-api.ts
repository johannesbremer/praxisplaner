// src/utils/browser-api.ts

/**
 * Utility functions for safely using browser APIs that may not be available in all environments.
 */

/**
 * Safely creates and dispatches a CustomEvent if available.
 */
export function dispatchCustomEvent(
  eventType: string,
  detail: unknown,
  target: EventTarget = globalThis,
): boolean {
  // Check if we're in a browser environment
  if (globalThis.window === undefined || typeof CustomEvent === "undefined") {
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
  return (
    globalThis.window !== undefined &&
    "FileSystemObserver" in globalThis &&
    typeof (globalThis as unknown as { FileSystemObserver?: unknown })
      .FileSystemObserver === "function"
  );
}

/**
 * Check if we're in a secure context with File System Access API support.
 */
export function isFileSystemAccessSupported(): boolean {
  return (
    globalThis.window !== undefined &&
    globalThis.isSecureContext &&
    "showDirectoryPicker" in globalThis
  );
}

/**
 * Safely check if DOMException is available and if an error is a DOMException.
 */
export function isDOMException(error: unknown): error is DOMException {
  return typeof DOMException !== "undefined" && error instanceof DOMException;
}

// Type definitions for the experimental FileSystemObserver API
type FileSystemObserverCallback = (
  records: readonly FileSystemObserverRecord[],
) => Promise<void> | void;

interface FileSystemObserverRecord {
  readonly changedHandle: FileSystemDirectoryHandle | FileSystemFileHandle;
  readonly relativePathComponents: readonly string[];
  readonly type: "appeared" | "disappeared" | "modified";
}

/**
 * Typed wrapper for FileSystemObserver that handles browser compatibility.
 */
export class SafeFileSystemObserver {
  private observer: null | {
    disconnect(): void;
    observe(
      handle: FileSystemDirectoryHandle,
      options?: { recursive?: boolean },
    ): Promise<void>;
    unobserve(handle: FileSystemDirectoryHandle): Promise<void>;
  } = null;

  constructor(
    callback: (
      records: import("../types").FileSystemChangeRecord[],
    ) => Promise<void> | void,
  ) {
    if (!isFileSystemObserverSupported()) {
      throw new Error(
        "FileSystemObserver is not supported in this environment",
      );
    }

    // Create the observer with proper error handling
    const WindowWithObserver = globalThis as unknown as {
      FileSystemObserver: new (callback_: FileSystemObserverCallback) => {
        disconnect(): void;
        observe(
          handle: FileSystemDirectoryHandle,
          options?: { recursive?: boolean },
        ): Promise<void>;
        unobserve(handle: FileSystemDirectoryHandle): Promise<void>;
      };
    };

    this.observer = new WindowWithObserver.FileSystemObserver(
      async (records: readonly FileSystemObserverRecord[]) => {
        // Convert records to our typed format
        const typedRecords: import("../types").FileSystemChangeRecord[] =
          records.map((record) => ({
            changedHandle: record.changedHandle as unknown as
              | import("../types").FileSystemDirectoryHandle
              | import("../types").FileSystemFileHandle,
            relativePathComponents: [...record.relativePathComponents],
            type: record.type,
          }));

        await callback(typedRecords);
      },
    );
  }

  disconnect(): void {
    this.observer?.disconnect();
  }

  observe(
    handle: import("../types").FileSystemDirectoryHandle,
    options?: import("../types").FileSystemObserverOptions,
  ): Promise<void> {
    if (!this.observer) {
      throw new Error("Observer not initialized");
    }
    return this.observer.observe(
      handle as unknown as FileSystemDirectoryHandle,
      options,
    );
  }

  unobserve(
    handle: import("../types").FileSystemDirectoryHandle,
  ): Promise<void> {
    if (!this.observer) {
      throw new Error("Observer not initialized");
    }
    return this.observer.unobserve(
      handle as unknown as FileSystemDirectoryHandle,
    );
  }
}

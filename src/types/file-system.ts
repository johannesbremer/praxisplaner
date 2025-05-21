// src/types/file-system.ts

// --- Base File System API Types ---

export interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

export interface FileSystemGetDirectoryOptions {
  create?: boolean;
}

export interface FileSystemGetFileOptions {
  create?: boolean;
}

export interface FileSystemHandle {
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
  readonly kind: "directory" | "file";
  readonly name: string;
  // queryPermission and requestPermission can be added if needed
}

export interface FileSystemRemoveOptions {
  recursive?: boolean;
}

// Represents a stream to write to a file.
// Simplified for demo purposes, focusing on write and close.
export interface FileSystemDirectoryHandle extends FileSystemHandle {
  getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle>;
  readonly kind: "directory";
  removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void>;
  // Iterators for directory contents
  [Symbol.asyncIterator]: FileSystemDirectoryHandle["entries"]; // Makes the handle itself async iterable
  entries(): AsyncIterableIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<
    FileSystemDirectoryHandle | FileSystemFileHandle
  >;
}

export interface FileSystemFileHandle extends FileSystemHandle {
  createWritable(
    options?: FileSystemCreateWritableOptions,
  ): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<File>;
  readonly kind: "file";
}

export interface FileSystemWritableFileStream
  extends WritableStream<Blob | BufferSource | string> {
  close(): Promise<void>;
  write(data: Blob | BufferSource | string): Promise<void>;
  // seek(position: number): Promise<void>;
  // truncate(size: number): Promise<void>;
}

// --- StorageManager extension for OPFS ---

export interface StorageManager {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
}

// --- File System Observer API Types ---

export interface FileSystemObserver {
  disconnect(): void;
  observe(
    target: FileSystemDirectoryHandle,
    options?: FileSystemObserverObserveOptions,
  ): Promise<void>;
  unobserve(target: FileSystemDirectoryHandle): void;
}

export type FileSystemObserverCallback = (
  records: readonly FileSystemObserverEntry[], // records is typically ReadonlyArray
  observer: FileSystemObserver,
) => Promise<void> | void;

export interface FileSystemObserverEntry {
  readonly changedHandle: FileSystemDirectoryHandle | FileSystemFileHandle; // The handle that changed
  readonly relativePath: null | string; // Path of changedHandle relative to observed directory
  readonly type: FileSystemObserverEntryType;
}

export type FileSystemObserverEntryType =
  | "appeared" // For changes originating outside the current FileSystemHandle instances
  | "created"
  | "deleted"
  | "disappeared" // For changes originating outside the current FileSystemHandle instances
  | "modified"
  | "moved";

export interface FileSystemObserverObserveOptions {
  /** Observe changes in subdirectories. Defaults to false. */
  recursive?: boolean;
}

// Type for the FileSystemObserver constructor
export interface FileSystemObserverConstructor {
  new (callback: FileSystemObserverCallback): FileSystemObserver;
  prototype: FileSystemObserver;
}

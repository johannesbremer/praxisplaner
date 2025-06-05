// src/types/file-system.ts

// --- Base File System API Types (Focused on GDT processing needs) ---

export interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

export interface FileSystemGetDirectoryOptions {
  create?: boolean;
}

export interface FileSystemGetFileOptions {
  create?: boolean;
}

// Describes the options for permission requests/queries
export interface FileSystemPermissionDescriptor {
  mode?: "read" | "readwrite";
}

// Represents the state of a permission
export type BrowserPermissionState = "denied" | "granted" | "prompt";

// Base interface for both files and directories
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
  [Symbol.asyncIterator]: FileSystemDirectoryHandle["entries"];
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

export interface FileSystemHandle {
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
  readonly kind: "directory" | "file";
  readonly name: string;
  queryPermission(
    descriptor?: FileSystemPermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemPermissionDescriptor,
  ): Promise<PermissionState>;
}

export interface FileSystemRemoveOptions {
  recursive?: boolean;
}

// Represents a stream to write to a file.
export interface FileSystemWritableFileStream
  extends WritableStream<Blob | BufferSource | string> {
  close(): Promise<void>;
  write(data: Blob | BufferSource | string): Promise<void>;
  // Optional: seek(position: number): Promise<void>;
  // Optional: truncate(size: number): Promise<void>;
}

// --- FileSystemObserver API Types ---

export interface FileSystemChangeRecord {
  changedHandle: FileSystemHandle;
  relativePathComponents: string[];
  type: "appeared" | "disappeared" | "modified";
}

export type FileSystemObserverCallback = (
  records: FileSystemChangeRecord[],
  observer: FileSystemObserver,
) => Promise<void> | void;

export interface FileSystemObserverOptions {
  recursive?: boolean;
}

export declare class FileSystemObserver {
  constructor(callback: FileSystemObserverCallback);
  disconnect(): void;
  observe(
    handle: FileSystemDirectoryHandle,
    options?: FileSystemObserverOptions,
  ): Promise<void>;
  unobserve(handle: FileSystemDirectoryHandle): Promise<void>;
}

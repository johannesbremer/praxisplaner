// src/types.ts

import type { Doc, Id } from "../convex/_generated/dataModel";

// Use getSlotsForDay as the base query type since getAvailableSlots was removed
export interface SchedulingDateRange {
  end: string;
  start: string;
}
export type SchedulingResult = SchedulingQuery["_returnType"];

export type SchedulingRuleSetId = SchedulingQuery["_args"]["ruleSetId"];
export type SchedulingSimulatedContext =
  SchedulingQuery["_args"]["simulatedContext"];

export type SchedulingSlot = SchedulingQuery["_returnType"]["slots"][number];
type ConvexApi = typeof import("../convex/_generated/api").api;
type SchedulingQuery = ConvexApi["scheduling"]["getSlotsForDay"];

/**
 * Patient information for calendar and sidebar components.
 * Derives fields from the Convex patients table for e2e type safety,
 * plus additional UI-specific fields.
 * All fields are optional to support partial patient info in the UI.
 */
export interface PatientInfo extends Partial<
  Pick<
    Doc<"patients">,
    "city" | "dateOfBirth" | "firstName" | "lastName" | "patientId" | "street"
  >
> {
  /** Convex database ID for linking appointments */
  convexPatientId?: Id<"patients">;
  /** Linked user for bookings created via /buchung */
  userId?: Id<"users">;
  /** Optional email when sourced from a user booking */
  email?: string;
  /** Whether this patient was just created (from GDT import) */
  isNewPatient?: boolean;
}

// Browser permission state
export type BrowserPermissionState = "denied" | "granted" | "prompt";

// Extended permission status for application use
export type PermissionStatus = "error" | BrowserPermissionState | null;

// --- File System Access API Types ---

export interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

export interface FileSystemGetDirectoryOptions {
  create?: boolean;
}

export interface FileSystemGetFileOptions {
  create?: boolean;
}

export interface FileSystemPermissionDescriptor {
  mode?: "read" | "readwrite";
}

export interface FileSystemRemoveOptions {
  recursive?: boolean;
}

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

// Represents a stream to write to a file
export interface FileSystemWritableFileStream extends WritableStream<
  Blob | BufferSource | string
> {
  close(): Promise<void>;
  write(data: Blob | BufferSource | string): Promise<void>;
}

// --- FileSystemObserver API Types ---

// FileSystemChangeRecord interface for FileSystemObserver
export interface FileSystemChangeRecord {
  changedHandle: FileSystemDirectoryHandle | FileSystemFileHandle;
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

// --- Global Browser API Extensions ---

// Options for window.showDirectoryPicker()
export interface DirectoryPickerOptions {
  id?: string; // A string to identify the picker and remember the last-picked directory
  mode?: "read" | "readwrite"; // Permission mode to request
  startIn?: // A well-known directory or a FileSystemHandle to start picking from
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos"
    | FileSystemHandle;
}

declare global {
  interface Window {
    // Declare showDirectoryPicker as it's part of the File System Access API
    showDirectoryPicker(
      options?: DirectoryPickerOptions,
    ): Promise<FileSystemDirectoryHandle>;
    // Declare FileSystemObserver as it's part of the File System Access API
    FileSystemObserver: typeof FileSystemObserver;
  }
}

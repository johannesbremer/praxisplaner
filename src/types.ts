// src/types.ts

import type { Doc, Id } from "../convex/_generated/dataModel";
import type {
  PersonalDataInput,
  SimulatedContextInput,
} from "../convex/typedDtos";
import type { InstantString, IsoDateString } from "../lib/typed-regex";

// Use getSlotsForDay as the base query type since getAvailableSlots was removed
export interface SchedulingDateRange {
  end: InstantString;
  start: InstantString;
}
export type SchedulingResult = SchedulingQuery["_returnType"];

export type SchedulingRuleSetId = SchedulingQuery["_args"]["ruleSetId"];
export type SchedulingSimulatedContext = SimulatedContextInput;

export type SchedulingSlot = SchedulingQuery["_returnType"]["slots"][number];
type BookingPersonalData = Partial<PersonalDataInput>;
type ConvexApi = typeof import("../convex/_generated/api").api;
type PvsPatientInfo = Omit<
  BookingPersonalData &
    Pick<Doc<"patients">, "city" | "dateOfBirth" | "patientId" | "street">,
  "dateOfBirth"
> & {
  convexPatientId: Id<"patients">;
  dateOfBirth?: IsoDateString;
  isNewPatient: boolean;
  phoneNumber?: string;
  recordType: "pvs";
  userId?: undefined;
};

type SchedulingQuery = ConvexApi["scheduling"]["getSlotsForDay"];

type TemporaryPatientInfo = Omit<
  BookingPersonalData &
    Pick<Doc<"patients">, "city" | "dateOfBirth" | "street">,
  "dateOfBirth"
> & {
  convexPatientId?: Id<"patients">;
  dateOfBirth?: IsoDateString;
  isNewPatient: boolean;
  name: string;
  patientId?: undefined;
  phoneNumber: string;
  recordType: "temporary";
  userId?: undefined;
};

type UserPatientInfo = Omit<BookingPersonalData, "dateOfBirth"> & {
  convexPatientId?: undefined;
  dateOfBirth?: IsoDateString;
  email?: string;
  isNewPatient?: boolean;
  patientId?: undefined;
  recordType?: undefined;
  userId: Id<"users">;
};

/**
 * Patient information for calendar and sidebar components.
 * Stored patients and booking users are modeled separately so creation flows
 * can rely on concrete IDs instead of broad optional bags.
 */
export type PatientInfo =
  | PvsPatientInfo
  | TemporaryPatientInfo
  | UserPatientInfo;

export type PracticePatientSelection =
  | {
      id: Id<"patients">;
      info: PatientInfo;
    }
  | {
      info: TemporaryPatientInfo;
    };

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

  var showDirectoryPicker: (
    options?: DirectoryPickerOptions,
  ) => Promise<FileSystemDirectoryHandle>;
}

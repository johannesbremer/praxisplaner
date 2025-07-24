// src/types.ts

import type { Doc, Id } from "../convex/_generated/dataModel";

// --- Application Types ---

// Calendar Event types for react-big-calendar
export interface CalendarEvent {
  end: Date;
  id: Id<"appointments">;
  resource?: {
    appointmentType?: string | undefined;
    locationId?: Id<"locations"> | undefined;
    notes?: string | undefined;
    patientId?: Id<"patients"> | undefined;
    practitionerId?: Id<"practitioners"> | undefined;
  };
  start: Date;
  title: string;
}

// Appointment data from Convex 
export interface AppointmentData {
  _creationTime: number;
  _id: Id<"appointments">;
  appointmentType?: string;
  createdAt: bigint;
  end: string;
  lastModified: bigint;
  locationId?: Id<"locations">;
  notes?: string;
  patientId?: Id<"patients">;
  practitionerId?: Id<"practitioners">;
  start: string;
  title: string;
}

// Practitioner with schedule info
export interface PractitionerWithSchedule {
  _creationTime: number;
  _id: Id<"practitioners">;
  earliestStart?: string; // earliest start time across all days
  latestEnd?: string; // latest end time across all days
  name: string;
  practiceId: Id<"practices">;
  workingDays: Set<number>; // days of week they work
}

// Base schedule data
export interface BaseScheduleData {
  _creationTime: number;
  _id: Id<"baseSchedules">;
  breakTimes?: { end: string; start: string }[];
  dayOfWeek: number;
  endTime: string;
  practitionerId: Id<"practitioners">;
  startTime: string;
}

// Browser permission state
export type BrowserPermissionState = "denied" | "granted" | "prompt";

// Extended permission status for application use
export type PermissionStatus = "error" | BrowserPermissionState | null;

// Patient tab data for UI
export interface PatientTabData {
  patientId: Doc<"patients">["patientId"];
  title: string;
}

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
export interface FileSystemWritableFileStream
  extends WritableStream<Blob | BufferSource | string> {
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

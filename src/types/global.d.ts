// src/types/global.d.ts

// Import only the specific handle types needed from your custom definitions
import type {
  FileSystemDirectoryHandle as CustomFileSystemDirectoryHandle,
  FileSystemHandle as CustomFileSystemHandle, // For the 'startIn' option
  FileSystemObserver as CustomFileSystemObserver,
  FileSystemObserverCallback as CustomFileSystemObserverCallback,
} from "./file-system";

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
    | CustomFileSystemHandle;
}

declare global {
  interface Window {
    // Declare showDirectoryPicker as it's part of the File System Access API
    showDirectoryPicker(
      options?: DirectoryPickerOptions,
    ): Promise<CustomFileSystemDirectoryHandle>;
    // Declare FileSystemObserver as it's part of the File System Access API
    FileSystemObserver: typeof CustomFileSystemObserver;
  }
}

// This export {} is crucial to ensure this file is treated as a module
// and its declarations are correctly picked up by TypeScript.
export {};

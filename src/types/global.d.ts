// src/types/global.d.ts

import type {
  FileSystemObserverConstructor as CustomFileSystemObserverConstructor,
  StorageManager as CustomStorageManager,
} from "./file-system";

declare global {
  interface Navigator {
    /**
     * Provides access to the Origin Private File System (OPFS).
     */
    storage: CustomStorageManager;
  }

  interface Window {
    /**
     * Constructor for the FileSystemObserver API.
     */
    FileSystemObserver: CustomFileSystemObserverConstructor;
  }

  // If you use `self` extensively and it might not always be `Window` (e.g., in Web Workers),
  // you might consider a broader augmentation or ensure `self` is correctly typed in context.
  // For client-side React components, `window.FileSystemObserver` is generally safe.
  // The demo uses `self.FileSystemObserver`, which in a browser client module refers to `window`.
}

export {};

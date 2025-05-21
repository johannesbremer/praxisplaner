// src/routes/file-observer.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  FileSystemObserver as IFileSystemObserver, // Renamed to avoid conflict with global
  FileSystemObserverCallback,
  FileSystemObserverEntry,
} from "../types/file-system";

export const Route = createFileRoute("/file-observer")({
  component: FileObserverDemoComponent,
});

const LOREM_IPSUM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

function FileObserverDemoComponent() {
  const [opLog, setOpLog] = useState<string[]>([]);
  const [observerLog, setObserverLog] = useState<string[]>([]);
  const [isApiSupported, setIsApiSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const observerInstanceRef = useRef<IFileSystemObserver | null>(null);

  const addOpLog = (message: string) => {
    setOpLog((prev) => [...prev.slice(-9), message]); // Keep last 10 entries
  };

  const addObserverLog = (message: string) => {
    setObserverLog((prev) => [...prev.slice(-9), message]); // Keep last 10 entries
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!window.isSecureContext) {
      setError(
        "File System APIs require a secure context (HTTPS or localhost).",
      );
      setIsApiSupported(false);
      return;
    }

    const apiSupported =
      "FileSystemObserver" in window &&
      navigator.storage &&
      typeof navigator.storage.getDirectory === "function";

    if (apiSupported) {
      setIsApiSupported(true);
    } else {
      setError(
        "Your browser does not support the File System Observer API and/or navigator.storage.getDirectory().",
      );
      setIsApiSupported(false);
      return;
    }

    // Initialize only if API is supported (which is now guaranteed by the checks above)
    const initialize = async () => {
      try {
        const root = await navigator.storage.getDirectory();
        rootHandleRef.current = root;
        addOpLog("🗂️ OPFS Root handle acquired.");

        // Clear existing entries for a clean demo run
        const entriesToClear: string[] = [];
        for await (const entryName of root.keys()) {
          entriesToClear.push(entryName);
        }
        for (const entryName of entriesToClear) {
          await root.removeEntry(entryName, { recursive: true });
        }
        if (entriesToClear.length > 0)
          addOpLog(`🧹 Cleared ${entriesToClear.length} entries from OPFS.`);

        const observerCb: FileSystemObserverCallback = (records) => {
          const icons: Partial<
            Record<FileSystemObserverEntry["type"], string>
          > = {
            created: "✅",
            appeared: "✨",
            modified: "📝",
            deleted: "🗑️",
            disappeared: "💨",
            moved: "➡️",
          };
          for (const record of records) {
            // Browsers (like Chrome) might create temporary .crswap files during writes
            if (record.changedHandle.name.endsWith(".crswap")) continue;

            addObserverLog(
              `${icons[record.type] || "❓"} ${record.changedHandle.kind} "${record.changedHandle.name}" was ${record.type}`,
            );
          }
        };

        // Type assertion for self.FileSystemObserver needed because global.d.ts augments window.FileSystemObserver
        const observer = new (self as any).FileSystemObserver(observerCb);
        await observer.observe(root);
        observerInstanceRef.current = observer;
        addObserverLog("👀 Observer started on OPFS root.");
      } catch (err) {
        console.error("Initialization error:", err);
        setError(`Initialization failed: ${(err as Error).message}`);
        setIsApiSupported(false); // Important: Set to false if init fails after API check passed
      }
    };

    initialize();

    return () => {
      if (observerInstanceRef.current) {
        if (rootHandleRef.current) {
          try {
            // Ensure rootHandleRef.current is valid before unobserving
            observerInstanceRef.current.unobserve(rootHandleRef.current);
          } catch (e) {
            // Log error, but don't prevent disconnect
            console.warn("Error during unobserve:", e);
          }
        }
        observerInstanceRef.current.disconnect();
        addObserverLog("🔌 Observer disconnected.");
      }
      // Clear refs on unmount
      rootHandleRef.current = null;
      observerInstanceRef.current = null;
    };
  }, []); // Run once on mount

  const getRandomFileHandle =
    async (): Promise<FileSystemFileHandle | null> => {
      if (!rootHandleRef.current) return null;
      const files: FileSystemFileHandle[] = [];
      for await (const entry of rootHandleRef.current.values()) {
        if (entry.kind === "file") {
          files.push(entry as FileSystemFileHandle);
        }
      }
      return files.length > 0
        ? files[Math.floor(Math.random() * files.length)]! // ! is safe due to files.length check
        : null;
    };

  const createFile = async () => {
    if (!rootHandleRef.current) return;
    const fileName = `file_${Date.now()}.txt`;
    try {
      const fileHandle = await rootHandleRef.current.getFileHandle(fileName, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      const randomText = LOREM_IPSUM.substring(
        0,
        Math.floor(Math.random() * LOREM_IPSUM.length) + 20,
      );
      await writable.write(randomText);
      await writable.close();
      addOpLog(`✅ Created: "${fileName}"`);
    } catch (e) {
      addOpLog(`❌ Error creating: ${(e as Error).message}`);
    }
  };

  const deleteFile = async () => {
    if (!rootHandleRef.current) return;
    const fileHandle = await getRandomFileHandle();
    if (!fileHandle) {
      addOpLog("🤷 No file to delete.");
      return;
    }
    try {
      await rootHandleRef.current.removeEntry(fileHandle.name, {
        recursive: false, // false for files
      });
      addOpLog(`🗑️ Deleted: "${fileHandle.name}"`);
    } catch (e) {
      addOpLog(`❌ Error deleting: ${(e as Error).message}`);
    }
  };

  const modifyFile = async () => {
    const fileHandle = await getRandomFileHandle();
    if (!fileHandle) {
      addOpLog("🤷 No file to modify.");
      return;
    }
    try {
      const writable = await fileHandle.createWritable({
        keepExistingData: false, // Overwrite
      });
      const randomText =
        LOREM_IPSUM.substring(
          0,
          Math.floor(Math.random() * LOREM_IPSUM.length) + 20,
        ) + " (modified)";
      await writable.write(randomText);
      await writable.close();
      addOpLog(`📝 Modified: "${fileHandle.name}"`);
    } catch (e) {
      addOpLog(`❌ Error modifying: ${(e as Error).message}`);
    }
  };

  // Effect for random operations
  useEffect(() => {
    if (!isApiSupported || !rootHandleRef.current) return; // Ensure API is ready and root handle exists

    const operations = [createFile, deleteFile, modifyFile];

    const performRandomOp = async () => {
      // Access latest opLog from state directly for bias calculation
      const currentOpLog = opLog; // This captures the opLog at the time of the interval tick
      const createdCount = currentOpLog.filter((s) =>
        s.startsWith("✅"),
      ).length;
      const deletedCount = currentOpLog.filter((s) =>
        s.startsWith("🗑️"),
      ).length;
      const opLength = createdCount - deletedCount;

      let opToPerform;
      if (opLength > 5 && Math.random() < 0.6) {
        opToPerform = deleteFile;
      } else if (opLength < 2 && Math.random() < 0.6) {
        opToPerform = createFile;
      } else {
        // The non-null assertion `!` is safe because operations array is not empty.
        opToPerform =
          operations[Math.floor(Math.random() * operations.length)]!;
      }
      await opToPerform();
    };

    const intervalId = setInterval(performRandomOp, 2500);
    return () => clearInterval(intervalId);
  }, [isApiSupported]); // Only re-run if API support status changes.
  // rootHandleRef.current might change, but the effect runs after initial setup,
  // and functions like performRandomOp use the ref's current value.
  // opLog is accessed directly from state within performRandomOp.

  if (isApiSupported === null) return <p>Checking API support...</p>;
  if (!isApiSupported)
    return (
      <div style={{ padding: "20px", color: "red" }}>
        <h1>Error</h1>
        <p>{error || "API not supported or initialization failed."}</p>
      </div>
    );

  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        padding: "20px",
        display: "flex",
        gap: "20px",
        flexDirection: "column",
      }}
    >
      {/* Simple inline styles for the log containers */}
      <style>{`.log-container { max-height: 200px; overflow-y: auto; border: 1px solid #eee; padding: 10px; background: #f9f9f9; min-width: 400px; } .log-container div { margin-bottom: 5px; font-size: 0.9em; white-space: nowrap; }`}</style>
      <div>
        <h1>File System Observer Demo (OPFS)</h1>
        <p>
          Random file operations in the Origin Private File System are logged
          below and observed by the FileSystemObserver API.
        </p>
        {/* This error display is mostly for initial setup errors if API is initially thought supported but init fails */}
        {error && !isApiSupported && (
          <p style={{ color: "red" }}>
            <strong>Initial Error:</strong> {error}
          </p>
        )}
        <div style={{ margin: "20px 0" }}>
          <button onClick={createFile} style={{ marginRight: "10px" }}>
            Create File
          </button>
          <button onClick={modifyFile} style={{ marginRight: "10px" }}>
            Modify File
          </button>
          <button onClick={deleteFile}>Delete File</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <div>
          <h2>🎲 Operations Log</h2>
          <div className="log-container">
            {opLog.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>
        </div>
        <div>
          <h2>👀 Observer Log</h2>
          <div className="log-container">
            {observerLog.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

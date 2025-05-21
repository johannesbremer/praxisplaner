// src/routes/praxisplaner.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  PermissionState,
} from "../types/file-system";

export const Route = createFileRoute("/praxisplaner")({
  component: PraxisPlanerComponent,
});

function PraxisPlanerComponent() {
  const [isFsaSupported, setIsFsaSupported] = useState<boolean | null>(null);
  const [gdtDirectoryHandle, setGdtDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [gdtDirPermission, setGdtDirPermission] =
    useState<PermissionState | null>(null);
  const [gdtLog, setGdtLog] = useState<string[]>([]);
  const [gdtError, setGdtError] = useState<string | null>(null);
  const gdtPollingIntervalRef = useRef<number | null>(null);

  const addGdtLog = useCallback((message: string) => {
    setGdtLog((prev) => [
      ...prev.slice(-29),
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const supported = "showDirectoryPicker" in window;
      setIsFsaSupported(supported);
      if (!supported) {
        setGdtError(
          "File System Access API (showDirectoryPicker) is not supported by your browser.",
        );
      } else if (!window.isSecureContext) {
        setGdtError(
          "File System Access API requires a secure context (HTTPS or localhost).",
        );
        setIsFsaSupported(false);
      }
    }
  }, []);

  const verifyAndSetPermission = useCallback(
    async (
      handle: FileSystemDirectoryHandle | null,
      withRequest = false,
    ): Promise<boolean> => {
      if (!handle) {
        setGdtDirPermission(null);
        return false;
      }

      let currentPermissionState: PermissionState;
      const permissionOptions = { mode: "readwrite" as const };

      try {
        if (withRequest) {
          currentPermissionState =
            await handle.requestPermission(permissionOptions);
        } else {
          currentPermissionState =
            await handle.queryPermission(permissionOptions);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("Error verifying permission:", errorMessage);
        addGdtLog(
          `❌ Error verifying permission for "${handle.name}": ${errorMessage}. Handle might be stale.`,
        );
        setGdtDirectoryHandle(null); // Invalidate handle if permission check fails badly
        setGdtDirPermission(null);
        return false;
      }

      setGdtDirPermission(currentPermissionState);

      if (currentPermissionState === "granted") {
        addGdtLog(
          `✅ Permission '${currentPermissionState}' for directory "${handle.name}".`,
        );
        return true;
      } else {
        addGdtLog(
          `⚠️ Permission '${currentPermissionState}' for directory "${handle.name}".`,
        );
        if (currentPermissionState === "prompt" && !withRequest) {
          addGdtLog(`💡 Click "Request Permission" to grant access.`);
        } else if (currentPermissionState === "denied") {
          addGdtLog(
            `🚫 Access to "${handle.name}" was denied. You may need to reset permissions in browser settings if you want to grant access later.`,
          );
        }
        return false;
      }
    },
    [addGdtLog],
  );

  const selectGdtDirectory = async () => {
    if (!isFsaSupported || !window.isSecureContext) {
      const errorMsg = !isFsaSupported
        ? "File System Access API not supported."
        : "Secure context required.";
      setGdtError(`Cannot select directory: ${errorMsg}`);
      addGdtLog(`❌ ${errorMsg}`);
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      setGdtDirectoryHandle(handle);
      addGdtLog(
        `📂 Selected directory: "${handle.name}". Verifying permissions...`,
      );
      const permissionGranted = await verifyAndSetPermission(handle, true);

      if (!permissionGranted) {
        addGdtLog(
          `User did not grant 'readwrite' permission for "${handle.name}" or permission is 'prompt'. Polling will not start/resume until granted.`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        addGdtLog("Directory selection aborted by user.");
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("Error selecting GDT directory:", err);
        setGdtError(`Error selecting GDT directory: ${errorMessage}`);
        addGdtLog(`❌ Error selecting directory: ${errorMessage}`);
      }
    }
  };

  const forgetGdtDirectory = useCallback(async () => {
    if (gdtPollingIntervalRef.current) {
      clearInterval(gdtPollingIntervalRef.current);
      gdtPollingIntervalRef.current = null;
    }
    if (gdtDirectoryHandle) {
      addGdtLog(
        `🗑️ Cleared selected GDT directory: "${gdtDirectoryHandle.name}".`,
      );
    }
    setGdtDirectoryHandle(null);
    setGdtDirPermission(null);
  }, [gdtDirectoryHandle, addGdtLog]);

  const parseAndProcessGdtFile = useCallback(
    async (
      dirHandle: FileSystemDirectoryHandle,
      fileHandle: FileSystemFileHandle,
    ) => {
      try {
        addGdtLog(
          `📄 Found GDT file: "${fileHandle.name}". Attempting to process...`,
        );
        const file = await fileHandle.getFile();
        const content = await file.text();
        addGdtLog(
          `📜 Content of "${fileHandle.name}" (first 100 chars): ${content.substring(0, 100)}...`,
        );
        const isValidGdt = content.includes("8000") && content.includes("8100"); // Simple GDT check
        if (isValidGdt) {
          addGdtLog(`✅ Successfully "parsed" GDT file: "${fileHandle.name}".`);
        } else {
          addGdtLog(
            `⚠️ File "${fileHandle.name}" might not be a valid GDT (or parser needs improvement).`,
          );
        }
        await dirHandle.removeEntry(fileHandle.name);
        addGdtLog(
          `🗑️ Deleted GDT file: "${fileHandle.name}" after processing.`,
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(
          `Error processing GDT file "${fileHandle.name}":`,
          errorMessage,
        );
        addGdtLog(
          `❌ Error processing GDT file "${fileHandle.name}": ${errorMessage}`,
        );
        // If deletion fails due to permission, re-query to update UI and stop polling if needed
        if (
          err instanceof DOMException &&
          err.name === "NotAllowedError" &&
          dirHandle
        ) {
          addGdtLog(
            `🚨 Failed to delete "${fileHandle.name}". Permission might have been revoked. Re-querying...`,
          );
          await verifyAndSetPermission(dirHandle, false);
        }
      }
    },
    [addGdtLog, verifyAndSetPermission],
  );

  // Polling for GDT files
  useEffect(() => {
    if (gdtDirectoryHandle && gdtDirPermission === "granted") {
      addGdtLog(
        `🚀 Starting GDT file polling in "${gdtDirectoryHandle.name}".`,
      );
      const POLLING_INTERVAL = 5000;

      const poll = async () => {
        if (!gdtDirectoryHandle) {
          // Handle might have been cleared
          if (gdtPollingIntervalRef.current)
            clearInterval(gdtPollingIntervalRef.current);
          gdtPollingIntervalRef.current = null;
          addGdtLog("🛑 GDT file polling stopped: Directory handle lost.");
          return;
        }

        // Re-check permission before each poll to handle revocation
        const currentPerm = await gdtDirectoryHandle.queryPermission({
          mode: "readwrite",
        });
        if (currentPerm !== "granted") {
          addGdtLog(
            `Polling skipped: Permission for "${gdtDirectoryHandle.name}" is now '${currentPerm}'.`,
          );
          setGdtDirPermission(currentPerm);
          if (gdtPollingIntervalRef.current) {
            clearInterval(gdtPollingIntervalRef.current);
            gdtPollingIntervalRef.current = null;
            addGdtLog("🛑 GDT file polling stopped due to permission change.");
          }
          return;
        }

        try {
          let foundGdtFileInPoll = false;
          for await (const entry of gdtDirectoryHandle.values()) {
            if (
              entry.kind === "file" &&
              entry.name.toLowerCase().endsWith(".gdt")
            ) {
              foundGdtFileInPoll = true;
              await parseAndProcessGdtFile(
                gdtDirectoryHandle,
                entry as FileSystemFileHandle,
              );
            }
          }
          if (foundGdtFileInPoll) {
            addGdtLog(
              `🔎 Poll completed for "${gdtDirectoryHandle.name}". Processed GDT files if any.`,
            );
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error("Error during GDT polling:", errorMessage);
          addGdtLog(`❌ Error during GDT polling: ${errorMessage}.`);
          // If directory becomes inaccessible during polling
          if (
            gdtDirectoryHandle &&
            err instanceof DOMException &&
            (err.name === "NotFoundError" || err.name === "NotAllowedError")
          ) {
            addGdtLog(
              `🚨 Directory "${gdtDirectoryHandle.name}" might be inaccessible. Stopping polling.`,
            );
            if (gdtPollingIntervalRef.current)
              clearInterval(gdtPollingIntervalRef.current);
            gdtPollingIntervalRef.current = null;
            setGdtDirectoryHandle(null); // Invalidate handle
            setGdtDirPermission(null);
          }
        }
      };

      poll(); // Initial poll
      gdtPollingIntervalRef.current = window.setInterval(
        poll,
        POLLING_INTERVAL,
      );

      return () => {
        if (gdtPollingIntervalRef.current) {
          clearInterval(gdtPollingIntervalRef.current);
          gdtPollingIntervalRef.current = null;
          addGdtLog(
            "🛑 GDT file polling stopped (component unmount or deps change).",
          );
        }
      };
    } else {
      // Ensure polling is stopped if conditions are not met (e.g., permission revoked, handle cleared)
      if (gdtPollingIntervalRef.current) {
        clearInterval(gdtPollingIntervalRef.current);
        gdtPollingIntervalRef.current = null;
        if (gdtDirectoryHandle) {
          // Log only if there was a directory to begin with
          addGdtLog(
            `🛑 GDT file polling not started/stopped for "${gdtDirectoryHandle.name}" (permission: ${gdtDirPermission || "none"}).`,
          );
        }
      }
      return undefined; // Explicitly return undefined for the 'else' path to satisfy TS7030
    }
  }, [
    gdtDirectoryHandle,
    gdtDirPermission,
    addGdtLog,
    parseAndProcessGdtFile,
    verifyAndSetPermission,
  ]);

  if (isFsaSupported === null) {
    return <p>Checking File System Access API support...</p>;
  }

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
      {/* Using a <style> tag for component-specific styles. Consider moving to CSS Modules or a styled-components solution for larger apps. */}
      <style>{`.log-container { max-height: 300px; overflow-y: auto; border: 1px solid #eee; padding: 10px; background: #f9f9f9; min-width: 400px; margin-top: 10px; } .log-container div { margin-bottom: 5px; font-size: 0.9em; white-space: nowrap; } .error-msg { color: red; font-weight: bold; }`}</style>

      <h1>Praxis GDT File Processor (Local Directory)</h1>

      {!isFsaSupported && (
        <p className="error-msg">
          {gdtError ||
            "File System Access API for local directories is not supported by your browser."}
        </p>
      )}
      {isFsaSupported && !window.isSecureContext && (
        <p className="error-msg">
          Local directory access requires a secure context (HTTPS or localhost).
        </p>
      )}

      {isFsaSupported && window.isSecureContext && (
        <>
          <div
            style={{
              margin: "10px 0",
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button onClick={selectGdtDirectory}>
              {gdtDirectoryHandle
                ? `Change Monitored Directory`
                : "Select GDT Directory to Monitor"}
            </button>
            {gdtDirectoryHandle && (
              <button
                onClick={forgetGdtDirectory}
                style={{ backgroundColor: "#ffdddd" }}
              >
                Stop Monitoring & Forget "{gdtDirectoryHandle.name}"
              </button>
            )}
          </div>

          {gdtDirectoryHandle && (
            <p>
              Monitored Directory: <strong>{gdtDirectoryHandle.name}</strong>{" "}
              <br />
              Permission Status:{" "}
              <strong
                style={{
                  color:
                    gdtDirPermission === "granted"
                      ? "green"
                      : gdtDirPermission === "denied"
                        ? "red"
                        : "sandybrown",
                }}
              >
                {gdtDirPermission || "Unknown"}
              </strong>
              {gdtDirPermission === "prompt" && (
                <button
                  onClick={() =>
                    verifyAndSetPermission(gdtDirectoryHandle, true)
                  }
                  style={{ backgroundColor: "#e6ffe6", marginLeft: "10px" }}
                >
                  Request Permission
                </button>
              )}
            </p>
          )}

          {gdtDirPermission === "denied" && (
            <p className="error-msg">
              Access to the directory was denied. You may need to reset
              permissions for this site in your browser settings (usually by
              clicking the lock icon in the address bar) if you wish to grant
              access again.
            </p>
          )}

          {gdtError && <p className="error-msg">Error: {gdtError}</p>}

          <div>
            <h3>📬 GDT Processing Log</h3>
            <div className="log-container">
              {gdtLog.length === 0 && (
                <div>Awaiting GDT directory selection and file events...</div>
              )}
              {gdtLog.map((msg, i) => (
                <div key={`gdt-${i}`}>{msg}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

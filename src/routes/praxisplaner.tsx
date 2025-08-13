// src/routes/praxisplaner.tsx

import { useConvexMutation } from "@convex-dev/react-query";
import {
  createFileRoute,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { Calendar as CalendarIcon, Settings, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { Doc } from "../../convex/_generated/dataModel";
import type {
  BrowserPermissionState,
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  PatientTabData,
  PermissionStatus,
} from "../types";

import { api } from "../../convex/_generated/api";
import {
  extractPatientData,
  parseGdtContent,
} from "../../convex/gdt/processing";
import { PatientTab } from "../components/patient-tab";
import { PraxisCalendar } from "../components/praxis-calendar";
import {
  isDOMException,
  isFileSystemObserverSupported,
  SafeFileSystemObserver,
} from "../utils/browser-api";
import { useErrorTracking } from "../utils/error-tracking";

export const Route = createFileRoute("/praxisplaner")({
  component: PraxisPlanerComponent,
});

const IDB_GDT_HANDLE_KEY = "gdtDirectoryHandle";
const IDB_GDT_PERMISSION_KEY = "gdtDirPermission";

const getPermissionBadgeVariant = (permission: PermissionStatus) => {
  if (permission === "granted") {
    return "secondary";
  }
  if (permission === "denied" || permission === "error") {
    return "destructive";
  }
  return "outline";
};

export function PraxisPlanerComponent() {
  const navigate = useNavigate();
  const { date: dateParam, tab: tabParam } = useParams({ strict: false });
  const location = useLocation();

  // Parse date param (YYYY-MM-DD) -> Date
  const parseYmd = (ymd?: string): Date | undefined => {
    if (!ymd) {
      return undefined;
    }
    // Expecting 4-2-2 digits
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      return undefined;
    }
    const [ys, ms, ds] = ymd.split("-");
    const y = Number(ys);
    const m = Number(ms);
    const d = Number(ds);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? undefined : dt;
  };

  const formatYmd = (dt: Date): string => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const isToday = (dt?: Date) => {
    if (!dt) {
      return true;
    }
    const now = new Date();
    return (
      dt.getFullYear() === now.getFullYear() &&
      dt.getMonth() === now.getMonth() &&
      dt.getDate() === now.getDate()
    );
  };

  const [isFsaSupported, setIsFsaSupported] = useState<boolean | null>(null);
  const [gdtDirectoryHandle, setGdtDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [gdtDirPermission, setGdtDirPermission] =
    useState<PermissionStatus>(null);
  const [gdtLog, setGdtLog] = useState<string[]>([]);
  const [gdtError, setGdtError] = useState<null | string>(null);
  const gdtFileObserverRef = useRef<null | SafeFileSystemObserver>(null);
  const [isLoadingHandle, setIsLoadingHandle] = useState(true);
  const isUserSelectingRef = useRef(false);

  // Tab management state
  const initialDate = parseYmd(dateParam);
  const [selectedDate, setSelectedDate] = useState<Date>(
    initialDate ?? new Date(),
  );
  const [activeTab, setActiveTab] = useState<string>(() =>
    location.pathname.endsWith("/nerds") || tabParam === "nerds"
      ? "settings"
      : "calendar",
  );
  const [patientTabs, setPatientTabs] = useState<PatientTabData[]>([]);

  // Check if GDT connection has issues for showing alert
  const hasGdtConnectionIssue =
    !isFsaSupported ||
    !globalThis.isSecureContext ||
    gdtDirPermission !== "granted";

  // Note: GDT preferences, file processing, and permission logging
  // will now be handled via IndexDB instead of Convex

  // Convex mutation for saving patient data
  const upsertPatientMutation = useConvexMutation(api.patients.upsertPatient);

  // Error tracking hook
  const { captureError } = useErrorTracking();

  const addGdtLog = useCallback((message: string) => {
    setGdtLog((prev) => [
      ...prev.slice(-29),
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
  }, []);

  // Tab management functions
  const openPatientTab = useCallback(
    (patientId: Doc<"patients">["patientId"], patientName?: string) => {
      const tabId = `patient-${patientId}`;
      const title = patientName || `Patient ${patientId}`;

      // Check if tab already exists
      const existingTab = patientTabs.find(
        (tab) => tab.patientId === patientId,
      );
      if (existingTab) {
        // Tab exists, just switch to it
        setActiveTab(tabId);
        addGdtLog(`🔄 Switched to existing tab for Patient ${patientId}.`);
        return;
      }

      // Create new tab
      const newTab: PatientTabData = {
        patientId,
        title,
      };

      setPatientTabs((prev) => [...prev, newTab]);
      setActiveTab(tabId);
      addGdtLog(`📋 Opened new tab for Patient ${patientId}.`);
    },
    [patientTabs, addGdtLog],
  );

  const closePatientTab = useCallback(
    (patientId: Doc<"patients">["patientId"]) => {
      const tabId = `patient-${patientId}`;
      setPatientTabs((prev) =>
        prev.filter((tab) => tab.patientId !== patientId),
      );

      // If we're closing the active tab, switch to calendar
      if (activeTab === tabId) {
        setActiveTab("calendar");
      }

      addGdtLog(`❌ Closed tab for Patient ${patientId}.`);
    },
    [activeTab, addGdtLog],
  );

  useEffect(() => {
    // Keep local states in sync if URL params change externally
    const nextDate = parseYmd(dateParam);
    if (nextDate && formatYmd(nextDate) !== formatYmd(selectedDate)) {
      setSelectedDate(nextDate);
    }
    const isSettingsPath =
      location.pathname.endsWith("/nerds") || tabParam === "nerds";
    const nextTab = isSettingsPath ? "settings" : "calendar";
    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [dateParam, tabParam, location.pathname, activeTab, selectedDate]);

  // Helper to push URL state
  const pushParams = useCallback(
    (d: Date, tab: string) => {
      const dateOut = isToday(d) ? undefined : formatYmd(d);
      if (tab === "settings") {
        // Navigate using the typed optional route with tab param
        void navigate({
          params: (prev: { date?: string; tab?: string }) => {
            const next = { ...prev } as { date?: string; tab?: string };
            delete next.date;
            next.tab = "nerds";
            return next;
          },
          replace: false,
          to: "/praxisplaner/{-$date}/{-$tab}",
        });
        return;
      }
      // Calendar tab: include date only if not today
      if (dateOut) {
        void navigate({ replace: false, to: "/praxisplaner/" + dateOut });
      } else {
        void navigate({ replace: false, to: "/praxisplaner" });
      }
    },
    [navigate],
  );

  // We sync to URL on interactions (tab/date handlers). No effect needed.

  useEffect(() => {
    const supported = "showDirectoryPicker" in globalThis;
    setIsFsaSupported(supported);
    if (!supported) {
      setGdtError(
        "File System Access API (showDirectoryPicker) is not supported by your browser.",
      );
      setIsLoadingHandle(false);
      return;
    }
    if (!globalThis.isSecureContext) {
      setGdtError(
        "File System Access API requires a secure context (HTTPS or localhost).",
      );
      setIsFsaSupported(false);
      setIsLoadingHandle(false);
      return;
    }
  }, []);

  const verifyAndSetPermission = useCallback(
    async (
      handle: FileSystemDirectoryHandle | null,
      withRequest = false,
      loggingContext = "general",
    ): Promise<boolean> => {
      if (!handle) {
        setGdtDirPermission(null);
        return false;
      }

      let resultingPermissionState: BrowserPermissionState;
      const permissionOptions = { mode: "readwrite" as const };
      const operationType = withRequest ? "request" : "query";

      try {
        addGdtLog(
          `[Perm] ${withRequest ? "Requesting" : "Querying"} 'readwrite' for "${handle.name}" (Ctx: ${loggingContext})...`,
        );
        resultingPermissionState = await (withRequest
          ? handle.requestPermission(permissionOptions)
          : handle.queryPermission(permissionOptions));

        // Permission logging now handled via IndexDB instead of Convex
        addGdtLog(
          `[Perm] Permission ${operationType}: ${handle.name}, ${resultingPermissionState}, Ctx: ${loggingContext}`,
        );

        setGdtDirPermission(resultingPermissionState);

        // Store permission metadata in IndexedDB to avoid split brain issues
        try {
          await idbSet(IDB_GDT_PERMISSION_KEY, {
            context: loggingContext,
            handleName: handle.name,
            permission: resultingPermissionState,
            timestamp: Date.now(),
          });
        } catch (idbError) {
          captureError(idbError, {
            context: "Failed to store permission metadata in IndexedDB",
            errorType: "indexeddb_storage",
            handleName: handle.name,
            loggingContext,
            operationType,
            permission: resultingPermissionState,
            storageKey: IDB_GDT_PERMISSION_KEY,
          });
          console.warn(
            "Failed to store permission metadata in IndexedDB:",
            idbError,
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        captureError(error, {
          context: `Error ${operationType} permission`,
          currentPermissionState: gdtDirPermission,
          domExceptionName: isDOMException(error) ? error.name : undefined,
          errorType: "file_system_permission",
          handleName: handle.name,
          isDOMException: isDOMException(error),
          loggingContext,
          operationType,
          permissionMode: "readwrite",
          withRequest,
        });
        console.error(`Error ${operationType} permission:`, errorMessage);
        addGdtLog(
          `[Perm] ❌ Error ${operationType} 'readwrite' for "${handle.name}": ${errorMessage}. (Ctx: ${loggingContext})`,
        );

        // Error logging now handled via IndexDB instead of Convex
        addGdtLog(`[Perm] ERROR for "${handle.name}": ${errorMessage}`);

        setGdtDirPermission("error");

        // Store error state in IndexedDB
        try {
          await idbSet(IDB_GDT_PERMISSION_KEY, {
            context: loggingContext,
            errorMessage,
            handleName: handle.name,
            permission: "error",
            timestamp: Date.now(),
          });
        } catch (idbError) {
          captureError(idbError, {
            context: "Failed to store error permission metadata in IndexedDB",
            errorType: "indexeddb_storage",
            handleName: handle.name,
            loggingContext,
            originalError: errorMessage,
            storageKey: IDB_GDT_PERMISSION_KEY,
          });
          console.warn(
            "Failed to store error permission metadata in IndexedDB:",
            idbError,
          );
        }

        return false;
      }

      if (resultingPermissionState === "granted") {
        addGdtLog(
          `[Perm] ✅ Permission '${resultingPermissionState}' for "${handle.name}".`,
        );
        return true;
      } else {
        addGdtLog(
          `[Perm] ⚠️ Permission '${resultingPermissionState}' for "${handle.name}".`,
        );
        if (resultingPermissionState === "prompt" && !withRequest) {
          addGdtLog(`💡 Click "Request Permission" to grant access.`);
        } else if (resultingPermissionState === "denied") {
          addGdtLog(
            `🚫 Access to "${handle.name}" was denied. Reset in browser settings.`,
          );
        }
        return false;
      }
    },
    [addGdtLog, captureError, gdtDirPermission],
  );

  useEffect(() => {
    if (isFsaSupported === false) {
      setIsLoadingHandle(false);
      return;
    }
    const loadPersistedHandle = async () => {
      // Skip if user is actively selecting a directory to avoid race condition
      if (isUserSelectingRef.current) {
        addGdtLog(
          "Skipping persistence recovery - user selection in progress.",
        );
        setIsLoadingHandle(false);
        return;
      }

      // Try to load persisted handle directly from IndexDB
      try {
        const persistedHandle =
          await idbGet<FileSystemDirectoryHandle>(IDB_GDT_HANDLE_KEY);
        if (persistedHandle) {
          addGdtLog(`Loaded handle "${persistedHandle.name}" from IndexedDB.`);

          // Also try to load permission metadata
          try {
            const permissionMetadata = await idbGet<{
              context: string;
              errorMessage?: string;
              handleName: string;
              permission: "error" | BrowserPermissionState;
              timestamp: number;
            }>(IDB_GDT_PERMISSION_KEY);

            if (
              permissionMetadata &&
              permissionMetadata.handleName === persistedHandle.name
            ) {
              addGdtLog(
                `Loaded permission metadata from IndexedDB: ${permissionMetadata.permission} (${new Date(permissionMetadata.timestamp).toLocaleString()})`,
              );
              // Set the cached permission, but still verify it below
              setGdtDirPermission(permissionMetadata.permission);
            }
          } catch (permError) {
            captureError(permError, {
              context: "Error loading permission metadata from IndexedDB",
              errorType: "indexeddb_loading",
              handleName: persistedHandle.name,
              operationContext: "initial load",
              storageKey: IDB_GDT_PERMISSION_KEY,
            });
            console.warn(
              "Error loading permission metadata from IndexedDB:",
              permError,
            );
          }

          setGdtDirectoryHandle(persistedHandle);
          await verifyAndSetPermission(persistedHandle, true, "initial load");
        } else {
          addGdtLog("No persisted handle found in IndexedDB.");
        }
      } catch (error) {
        captureError(error, {
          context: "Error loading handle from IndexedDB",
          domExceptionName: isDOMException(error) ? error.name : undefined,
          errorType: "indexeddb_loading",
          isDOMException: isDOMException(error),
          operationContext: "initial load",
          storageKey: IDB_GDT_HANDLE_KEY,
        });
        console.error("Error loading handle from IndexedDB:", error);
        addGdtLog(
          `Error loading handle: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      setIsLoadingHandle(false);
    };
    if (isFsaSupported && globalThis.isSecureContext) {
      void loadPersistedHandle();
    }
  }, [isFsaSupported, addGdtLog, verifyAndSetPermission, captureError]);

  const selectGdtDirectory = async () => {
    if (!isFsaSupported || !globalThis.isSecureContext) {
      setGdtError(
        isFsaSupported ? "Secure context required." : "FSA not supported.",
      );
      addGdtLog(
        `❌ ${isFsaSupported ? "Secure context required." : "FSA not supported."}`,
      );
      return;
    }
    try {
      // Set flag to prevent race condition with loadPersistedHandle
      isUserSelectingRef.current = true;

      // Experimental browser API - type assertion needed
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const handle = (await (globalThis as any).showDirectoryPicker({
        mode: "readwrite",
      })) as FileSystemDirectoryHandle;
      await idbSet(IDB_GDT_HANDLE_KEY, handle);
      // GDT preferences now stored in IndexDB instead of Convex
      addGdtLog(`Saved handle for "${handle.name}" to IndexedDB.`);
      setGdtDirectoryHandle(handle);
      await verifyAndSetPermission(handle, true, "user selected new directory");
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        addGdtLog("Directory selection aborted by user.");
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setGdtError(`Error selecting directory: ${errorMsg}`);
        addGdtLog(`❌ Error selecting directory: ${errorMsg}`);
      }
    } finally {
      // Clear flag after selection is complete
      isUserSelectingRef.current = false;
    }
  };

  const forgetGdtDirectory = useCallback(async () => {
    if (gdtFileObserverRef.current) {
      gdtFileObserverRef.current.disconnect();
      gdtFileObserverRef.current = null;
    }
    const name = gdtDirectoryHandle?.name;
    addGdtLog(
      name
        ? `🗑️ Clearing GDT directory: "${name}".`
        : "🗑️ Clearing GDT directory.",
    );
    try {
      await idbDel(IDB_GDT_HANDLE_KEY);
      await idbDel(IDB_GDT_PERMISSION_KEY);
      // GDT preferences now stored in IndexDB instead of Convex
      addGdtLog(
        name
          ? `Removed handle & permission metadata for "${name}" from IndexedDB.`
          : "Cleared stored handle/preference.",
      );
    } catch (error) {
      addGdtLog(
        `Error forgetting directory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    setGdtDirectoryHandle(null);
    setGdtDirPermission(null);
  }, [gdtDirectoryHandle, addGdtLog]);

  const parseAndProcessGdtFile = useCallback(
    async (
      directoryHandle: FileSystemDirectoryHandle,
      fileHandle: FileSystemFileHandle,
    ) => {
      let fileContent = "";
      const fileName = fileHandle.name;
      let procerrorMsg: string | undefined;
      let file: File | undefined;

      try {
        addGdtLog(`📄 Processing "${fileName}"...`);
        file = await fileHandle.getFile();
        fileContent = await file.text();
        addGdtLog(`📜 Content (100 chars): ${fileContent.slice(0, 100)}...`);

        // Parse GDT content and extract patient data
        try {
          const gdtFields = parseGdtContent(fileContent);
          const patientData = extractPatientData(gdtFields);

          if (patientData.patientId > 0) {
            // Save patient data to Convex
            const result = await upsertPatientMutation({
              ...patientData,
              sourceGdtFileName: fileName,
            });

            addGdtLog(
              `✅ Parsed "${fileName}" - Patient ${patientData.patientId} ${result.isNewPatient ? "created" : "updated"}.`,
            );

            // Open patient tab with name if available
            const patientName =
              patientData.firstName && patientData.lastName
                ? `${patientData.firstName} ${patientData.lastName}`
                : undefined;
            openPatientTab(patientData.patientId, patientName);
          } else {
            procerrorMsg = `File "${fileName}" missing valid patient ID.`;
            addGdtLog(`⚠️ ${procerrorMsg}`);
          }
        } catch (gdtError) {
          procerrorMsg = `GDT parsing error in "${fileName}": ${gdtError instanceof Error ? gdtError.message : String(gdtError)}`;
          addGdtLog(`⚠️ ${procerrorMsg}`);

          // Capture specific GDT parsing error with comprehensive context
          captureError(gdtError, {
            context: "GDT parsing error",
            directoryName: directoryHandle.name,
            domExceptionName: isDOMException(gdtError)
              ? gdtError.name
              : undefined,
            errorType: "gdt_parsing",
            fileContent, // Full file content as requested
            fileLastModified: new Date(file.lastModified).toISOString(),
            fileName,
            fileSize: file.size,
            fileType: fileName.endsWith(".gdt")
              ? "gdt-file"
              : file.type || "unknown",
            isDOMException: isDOMException(gdtError),
          });
        }

        // File processing completed, capture any processing errors to PostHog
        if (procerrorMsg) {
          captureError(new Error(procerrorMsg), {
            context: "GDT file processing error",
            directoryName: directoryHandle.name,
            errorType: "file_processing",
            fileContent, // Include full content for debugging
            fileContentLength: fileContent.length,
            fileLastModified: new Date(file.lastModified).toISOString(),
            fileName,
            fileSize: file.size,
            fileType: fileName.endsWith(".gdt")
              ? "gdt-file"
              : file.type || "unknown",
            operationType: "processing",
          });
        }

        await directoryHandle.removeEntry(fileName);
        addGdtLog(`🗑️ Deleted "${fileName}".`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        addGdtLog(`❌ Error with "${fileName}": ${errorMsg}`);

        // Capture error with PostHog instead of storing in IndexedDB
        captureError(error, {
          context: "GDT file processing error",
          directoryName: directoryHandle.name,
          domExceptionName: isDOMException(error) ? error.name : undefined,
          errorType: "file_processing",
          fileContent, // Include full content for debugging
          fileContentLength: fileContent.length,
          fileLastModified: file
            ? new Date(file.lastModified).toISOString()
            : undefined,
          fileName,
          fileSize: file ? file.size : undefined,
          fileType: file
            ? fileName.endsWith(".gdt")
              ? "gdt-file"
              : file.type || "unknown"
            : "unknown",
          isDOMException: isDOMException(error),
          operationType: "delete",
        });

        if (
          isDOMException(error) &&
          (error.name === "NotAllowedError" || error.name === "SecurityError")
        ) {
          addGdtLog(
            `🚨 Delete failed for "${fileName}". Re-checking permissions.`,
          );
          await verifyAndSetPermission(
            directoryHandle,
            false,
            "post delete failure check",
          );
        }
      }
    },
    [
      addGdtLog,
      verifyAndSetPermission,
      upsertPatientMutation,
      openPatientTab,
      captureError,
    ],
  );

  useEffect(() => {
    if (gdtDirectoryHandle && gdtDirPermission === "granted") {
      addGdtLog(
        `🚀 Starting FileSystemObserver monitoring in "${gdtDirectoryHandle.name}".`,
      );

      // Check if FileSystemObserver is supported
      if (!isFileSystemObserverSupported()) {
        addGdtLog(
          "❌ FileSystemObserver API not supported. Falling back to error state.",
        );
        setGdtDirPermission("error");
        return;
      }

      let isObserverActive = true;

      const setupObserver = async () => {
        try {
          // Create FileSystemObserver with callback using typed wrapper
          const observer = new SafeFileSystemObserver(async (records) => {
            if (!isObserverActive) {
              return;
            }

            // First verify we still have permission
            let currentPermission: BrowserPermissionState;
            try {
              currentPermission = await gdtDirectoryHandle.queryPermission({
                mode: "readwrite",
              });

              // Log permission changes

              if (currentPermission !== gdtDirPermission) {
                addGdtLog(
                  `ℹ️ Perm for "${gdtDirectoryHandle.name}" changed during observation: '${gdtDirPermission}' -> '${currentPermission}'.`,
                );
                setGdtDirPermission(currentPermission);

                // Store updated permission in IndexedDB
                try {
                  await idbSet(IDB_GDT_PERMISSION_KEY, {
                    context: "FileSystemObserver permission check",
                    handleName: gdtDirectoryHandle.name,
                    permission: currentPermission,
                    timestamp: Date.now(),
                  });
                } catch (idbError) {
                  captureError(idbError, {
                    context: "Failed to store permission change in IndexedDB",
                    errorType: "indexeddb_storage",
                    handleName: gdtDirectoryHandle.name,
                    operationContext: "FileSystemObserver permission check",
                    permission: currentPermission,
                    previousPermission: gdtDirPermission,
                    storageKey: IDB_GDT_PERMISSION_KEY,
                  });
                  console.warn(
                    "Failed to store permission change in IndexedDB:",
                    idbError,
                  );
                }

                // Permission logging now handled via IndexDB instead of Convex
              }

              if (currentPermission !== "granted") {
                addGdtLog(
                  `🛑 Stopping FileSystemObserver: permission no longer 'granted' (now '${currentPermission}').`,
                );
                observer.disconnect();
                gdtFileObserverRef.current = null;
                return;
              }
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              addGdtLog(
                `❌ Error querying permission in FileSystemObserver for "${gdtDirectoryHandle.name}": ${errorMsg}`,
              );
              // Error logging now handled via IndexDB instead of Convex
              setGdtDirPermission("error");

              // Store error state in IndexedDB
              try {
                await idbSet(IDB_GDT_PERMISSION_KEY, {
                  context: "FileSystemObserver permission query error",
                  errorMsg,
                  handleName: gdtDirectoryHandle.name,
                  permission: "error",
                  timestamp: Date.now(),
                });
              } catch (idbError) {
                captureError(idbError, {
                  context: "Failed to store error state in IndexedDB",
                  errorType: "indexeddb_storage",
                  handleName: gdtDirectoryHandle.name,
                  operationContext: "FileSystemObserver permission query error",
                  originalError: errorMsg,
                  storageKey: IDB_GDT_PERMISSION_KEY,
                });
                console.warn(
                  "Failed to store error state in IndexedDB:",
                  idbError,
                );
              }

              observer.disconnect();
              gdtFileObserverRef.current = null;
              return;
            }

            // Process file change records
            const gdtFiles = records.filter((record) => {
              const fileName =
                record.relativePathComponents[
                  record.relativePathComponents.length - 1
                ];
              return (
                record.type === "appeared" &&
                record.changedHandle.kind === "file" &&
                fileName?.toLowerCase().endsWith(".gdt")
              );
            });

            if (gdtFiles.length > 0) {
              addGdtLog(
                `📁 Detected ${gdtFiles.length} new GDT file(s) in "${gdtDirectoryHandle.name}".`,
              );

              for (const record of gdtFiles) {
                try {
                  await parseAndProcessGdtFile(
                    gdtDirectoryHandle,
                    record.changedHandle as FileSystemFileHandle,
                  );
                } catch (error) {
                  const errorMsg =
                    error instanceof Error ? error.message : String(error);
                  addGdtLog(`❌ Error processing detected file: ${errorMsg}`);

                  // Capture error for file processing failure
                  captureError(error, {
                    changeType: record.type,
                    context:
                      "Error processing detected file in FileSystemObserver",
                    currentPermission: gdtDirPermission,
                    directoryName: gdtDirectoryHandle.name,
                    domExceptionName: isDOMException(error)
                      ? error.name
                      : undefined,
                    errorType: "file_system_observer",
                    fileName:
                      record.relativePathComponents[
                        record.relativePathComponents.length - 1
                      ],
                    handleKind: record.changedHandle.kind,
                    isDOMException: isDOMException(error),
                    relativePathComponents: record.relativePathComponents,
                  });
                }
              }
            }
          });

          // Start observing the directory
          await observer.observe(gdtDirectoryHandle, { recursive: false });
          gdtFileObserverRef.current = observer;
          addGdtLog(
            `👁️ FileSystemObserver active for "${gdtDirectoryHandle.name}".`,
          );
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          addGdtLog(
            `❌ Error setting up FileSystemObserver for "${gdtDirectoryHandle.name}": ${errorMsg}`,
          );
          setGdtDirPermission("error");

          // Capture FileSystemObserver setup error
          captureError(error, {
            context: "Error setting up FileSystemObserver",
            currentPermission: gdtDirPermission,
            directoryName: gdtDirectoryHandle.name,
            domExceptionName: isDOMException(error) ? error.name : undefined,
            errorType: "file_system_observer_setup",
            isDOMException: isDOMException(error),
            isObserverSupported: isFileSystemObserverSupported(),
            observerConfig: { recursive: false },
          });
        }
      };

      void setupObserver();

      return () => {
        isObserverActive = false;

        if (gdtFileObserverRef.current) {
          gdtFileObserverRef.current.disconnect();
          gdtFileObserverRef.current = null;
          addGdtLog(
            `🛑 FileSystemObserver stopped for "${gdtDirectoryHandle.name}" (component unmount or deps change).`,
          );
        }
      };
    } else {
      if (gdtFileObserverRef.current) {
        gdtFileObserverRef.current.disconnect();
        gdtFileObserverRef.current = null;
        if (gdtDirectoryHandle) {
          addGdtLog(
            `🛑 FileSystemObserver not started/stopped for "${gdtDirectoryHandle.name}" (permission: ${gdtDirPermission || "none"}).`,
          );
        }
      }
      return;
    }
  }, [
    gdtDirectoryHandle,
    gdtDirPermission,
    addGdtLog,
    parseAndProcessGdtFile,
    captureError,
  ]);

  if (isLoadingHandle || isFsaSupported === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <p className="text-lg">Initializing...</p>
      </div>
    );
  }

  const settingsContent = (
    <div className="container mx-auto max-w-4xl p-6 space-y-8 bg-background text-foreground">
      <div className="flex flex-col">
        <h1 className="text-3xl font-bold tracking-tight mb-6">
          Praxis GDT File Processor
        </h1>

        {!isFsaSupported && (
          <Alert className="mb-4" variant="destructive">
            <AlertTitle>API Not Supported</AlertTitle>
            <AlertDescription>
              {gdtError || "FSA not supported."}
            </AlertDescription>
          </Alert>
        )}
        {isFsaSupported && !globalThis.isSecureContext && (
          <Alert className="mb-4" variant="destructive">
            <AlertTitle>Secure Context Required</AlertTitle>
            <AlertDescription>HTTPS or localhost needed.</AlertDescription>
          </Alert>
        )}

        {isFsaSupported && globalThis.isSecureContext && (
          <>
            <div className="flex flex-wrap gap-3 mb-6">
              <Button
                onClick={() => void selectGdtDirectory()}
                variant="default"
              >
                {gdtDirectoryHandle
                  ? `Change Dir (${gdtDirectoryHandle.name})`
                  : "Select GDT Directory"}
              </Button>
              {gdtDirectoryHandle && (
                <Button
                  onClick={() => void forgetGdtDirectory()}
                  variant="destructive"
                >
                  Forget &quot;{gdtDirectoryHandle.name}&quot;
                </Button>
              )}
            </div>

            {gdtDirectoryHandle && (
              <Card className="mb-6">
                <CardContent className="pt-6 space-y-2">
                  <div>
                    <span className="font-medium">Monitored:</span>{" "}
                    <span className="font-semibold">
                      {gdtDirectoryHandle.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Permission:</span>
                    <Badge
                      className={
                        gdtDirPermission === "granted"
                          ? "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100"
                          : gdtDirPermission === "denied" ||
                              gdtDirPermission === "error"
                            ? ""
                            : "bg-amber-100 text-amber-800 dark:bg-amber-700 dark:text-amber-100"
                      }
                      variant={getPermissionBadgeVariant(gdtDirPermission)}
                    >
                      {gdtDirPermission ?? "Unknown"}
                    </Badge>
                    {gdtDirPermission === "prompt" && (
                      <Button
                        onClick={() => {
                          void verifyAndSetPermission(
                            gdtDirectoryHandle,
                            true,
                            "user request button",
                          );
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Request Permission
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
            {gdtDirPermission === "denied" && (
              <Alert className="mb-4" variant="destructive">
                <AlertTitle>Permission Denied</AlertTitle>
                <AlertDescription>
                  Access denied. Check browser site settings.
                </AlertDescription>
              </Alert>
            )}
            {gdtError && (
              <Alert className="mb-4" variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{gdtError}</AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">📬 Real-time Log</CardTitle>
                <CardDescription>Live GDT monitor events.</CardDescription>
                <Separator className="my-2" />
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-60 rounded-md border p-4 bg-muted font-mono text-sm">
                  <pre className="whitespace-pre-wrap">
                    {gdtLog.length === 0
                      ? "Awaiting events..."
                      : gdtLog.join("\n")}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Note: Processed files and permission events are now handled via IndexDB */}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-screen bg-background text-foreground">
      <Tabs
        className="h-full flex flex-col"
        onValueChange={(val) => {
          setActiveTab(val);
          pushParams(selectedDate, val);
        }}
        value={activeTab}
      >
        <div className="border-b px-6 py-3">
          <TabsList className="h-auto">
            <TabsTrigger className="flex items-center gap-2" value="calendar">
              <CalendarIcon className="h-4 w-4" />
              Terminkalender
            </TabsTrigger>
            <TabsTrigger className="flex items-center gap-2" value="settings">
              <Settings className="h-4 w-4" />
              Für Nerds
            </TabsTrigger>
            {patientTabs.map((tab) => (
              <TabsTrigger
                className="flex items-center gap-2 group relative"
                key={`patient-${tab.patientId}`}
                value={`patient-${tab.patientId}`}
              >
                <User className="h-4 w-4" />
                {tab.title}
                <Button
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 ml-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    closePatientTab(tab.patientId);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <X className="h-3 w-3" />
                </Button>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent className="h-full overflow-auto p-6" value="calendar">
            <div className="container mx-auto max-w-7xl">
              <div className="mb-6">
                <h1 className="text-3xl font-bold tracking-tight mb-2">
                  Terminkalender
                </h1>
                <p className="text-muted-foreground">
                  Verwalten Sie Ihre Praxistermine mit 5-Minuten-Intervallen
                </p>
              </div>
              <PraxisCalendar
                onDateChange={(d) => {
                  setSelectedDate(d);
                }}
                showGdtAlert={hasGdtConnectionIssue}
                simulationDate={selectedDate}
              />
            </div>
          </TabsContent>

          <TabsContent className="h-full overflow-auto" value="settings">
            {settingsContent}
          </TabsContent>

          {patientTabs.map((tab) => (
            <TabsContent
              className="h-full overflow-auto"
              key={`patient-${tab.patientId}`}
              value={`patient-${tab.patientId}`}
            >
              <PatientTab patientId={tab.patientId} />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}

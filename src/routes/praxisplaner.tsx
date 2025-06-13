// src/routes/praxisplaner.tsx

import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  Suspense,
  lazy,
} from "react";
import type {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  BrowserPermissionState,
  FileSystemObserver,
} from "../types/file-system";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, User, X } from "lucide-react";

// Lazy load PatientTab component for better code splitting
const PatientTab = lazy(() =>
  import("../components/PatientTab").then((module) => ({
    default: module.PatientTab,
  })),
);

import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  parseGdtContent,
  extractPatientData,
} from "../../convex/gdt/processing";

// Local type for PermissionState used in this component
type PermissionStatus = BrowserPermissionState | "error" | null;

interface PatientTabData {
  patientId: Doc<"patients">["patientId"];
  title: string;
}

export const Route = createFileRoute("/praxisplaner")({
  component: PraxisPlanerComponent,
});

const IDB_GDT_HANDLE_KEY = "gdtDirectoryHandle";
const IDB_GDT_PERMISSION_KEY = "gdtDirectoryPermission";

function PraxisPlanerComponent() {
  const [isFsaSupported, setIsFsaSupported] = useState<boolean | null>(null);
  const [gdtDirectoryHandle, setGdtDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [gdtDirPermission, setGdtDirPermission] =
    useState<PermissionStatus>(null);
  const [gdtLog, setGdtLog] = useState<string[]>([]);
  const [gdtError, setGdtError] = useState<string | null>(null);
  const gdtFileObserverRef = useRef<FileSystemObserver | null>(null);
  const [isLoadingHandle, setIsLoadingHandle] = useState(true);
  const isUserSelectingRef = useRef(false);

  // Tab management state
  const [activeTab, setActiveTab] = useState<string>("settings");
  const [patientTabs, setPatientTabs] = useState<PatientTabData[]>([]);

  // Note: GDT preferences, file processing, and permission logging
  // will now be handled via IndexDB instead of Convex

  // Convex mutation for saving patient data
  const upsertPatientMutation = useConvexMutation(api.patients.upsertPatient);

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

      // If we're closing the active tab, switch to settings
      if (activeTab === tabId) {
        setActiveTab("settings");
      }

      addGdtLog(`❌ Closed tab for Patient ${patientId}.`);
    },
    [activeTab, addGdtLog],
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      const supported = "showDirectoryPicker" in window;
      setIsFsaSupported(supported);
      if (!supported) {
        setGdtError(
          "File System Access API (showDirectoryPicker) is not supported by your browser.",
        );
        setIsLoadingHandle(false);
        return;
      }
      if (!window.isSecureContext) {
        setGdtError(
          "File System Access API requires a secure context (HTTPS or localhost).",
        );
        setIsFsaSupported(false);
        setIsLoadingHandle(false);
        return;
      }
    }
  }, []);

  const verifyAndSetPermission = useCallback(
    async (
      handle: FileSystemDirectoryHandle | null,
      withRequest = false,
      loggingContext: string = "general",
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
        if (withRequest) {
          resultingPermissionState =
            await handle.requestPermission(permissionOptions);
        } else {
          resultingPermissionState =
            await handle.queryPermission(permissionOptions);
        }

        // Permission logging now handled via IndexDB instead of Convex
        addGdtLog(
          `[Perm] Permission ${operationType}: ${handle.name}, ${resultingPermissionState}, Ctx: ${loggingContext}`,
        );

        setGdtDirPermission(resultingPermissionState);

        // Store permission metadata in IndexedDB to avoid split brain issues
        try {
          await idbSet(IDB_GDT_PERMISSION_KEY, {
            handleName: handle.name,
            permission: resultingPermissionState,
            timestamp: Date.now(),
            context: loggingContext,
          });
        } catch (idbError) {
          console.warn(
            "Failed to store permission metadata in IndexedDB:",
            idbError,
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
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
            handleName: handle.name,
            permission: "error",
            timestamp: Date.now(),
            context: loggingContext,
            errorMessage: errorMessage,
          });
        } catch (idbError) {
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
    [addGdtLog],
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
              handleName: string;
              permission: BrowserPermissionState | "error";
              timestamp: number;
              context: string;
              errorMessage?: string;
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
        console.error("Error loading handle from IndexedDB:", error);
        addGdtLog(
          `Error loading handle: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      setIsLoadingHandle(false);
    };
    if (isFsaSupported && window.isSecureContext) {
      loadPersistedHandle();
    }
  }, [isFsaSupported, addGdtLog, verifyAndSetPermission]);

  const selectGdtDirectory = async () => {
    if (!isFsaSupported || !window.isSecureContext) {
      setGdtError(
        !isFsaSupported ? "FSA not supported." : "Secure context required.",
      );
      addGdtLog(
        `❌ ${!isFsaSupported ? "FSA not supported." : "Secure context required."}`,
      );
      return;
    }
    try {
      // Set flag to prevent race condition with loadPersistedHandle
      isUserSelectingRef.current = true;

      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await idbSet(IDB_GDT_HANDLE_KEY, handle);
      // GDT preferences now stored in IndexDB instead of Convex
      addGdtLog(`Saved handle for "${handle.name}" to IndexedDB.`);
      setGdtDirectoryHandle(handle);
      await verifyAndSetPermission(handle, true, "user selected new directory");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        addGdtLog("Directory selection aborted by user.");
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setGdtError(`Error selecting directory: ${errorMessage}`);
        addGdtLog(`❌ Error selecting directory: ${errorMessage}`);
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
    } catch (e) {
      addGdtLog(
        `Error forgetting directory: ${e instanceof Error ? e.message : String(e)}`,
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
      let fileContent = "";
      const fileName = fileHandle.name;
      let procErrorMessage: string | undefined = undefined;

      try {
        addGdtLog(`📄 Processing "${fileName}"...`);
        const file = await fileHandle.getFile();
        fileContent = await file.text();
        addGdtLog(
          `📜 Content (100 chars): ${fileContent.substring(0, 100)}...`,
        );

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
            procErrorMessage = `File "${fileName}" missing valid patient ID.`;
            addGdtLog(`⚠️ ${procErrorMessage}`);
          }
        } catch (gdtError) {
          procErrorMessage = `GDT parsing error in "${fileName}": ${gdtError instanceof Error ? gdtError.message : String(gdtError)}`;
          addGdtLog(`⚠️ ${procErrorMessage}`);
        }

        // File processing metadata stored in IndexDB instead of Convex
        // Only store minimal data needed for error tracking, not full file content
        const processedFilePayload = {
          fileName: fileName,
          processingErrorMessage: procErrorMessage,
        };

        // Store file processing metadata in IndexedDB
        try {
          await idbSet(
            `gdt_processed_${fileName}_${Date.now()}`,
            processedFilePayload,
          );
          addGdtLog(
            `💾 Stored "${fileName}" error tracking data in IndexedDB.`,
          );
        } catch (idbError) {
          addGdtLog(
            `⚠️ Failed to store "${fileName}" error tracking data in IndexedDB: ${idbError instanceof Error ? idbError.message : String(idbError)}`,
          );
        }

        await dirHandle.removeEntry(fileName);
        addGdtLog(`🗑️ Deleted "${fileName}".`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        addGdtLog(`❌ Error with "${fileName}": ${errorMsg}`);

        // Error logging now handled via IndexDB instead of Convex
        try {
          await idbSet(`gdt_error_${fileName}_${Date.now()}`, {
            fileName,
            error: errorMsg,
            timestamp: Date.now(),
          });
          addGdtLog(`💾 Stored error for "${fileName}" in IndexedDB.`);
        } catch (idbError) {
          addGdtLog(
            `⚠️ Failed to store error in IndexedDB: ${idbError instanceof Error ? idbError.message : String(idbError)}`,
          );
        }

        if (
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError") &&
          dirHandle
        ) {
          addGdtLog(
            `🚨 Delete failed for "${fileName}". Re-checking permissions.`,
          );
          await verifyAndSetPermission(
            dirHandle,
            false,
            "post delete failure check",
          );
        }
      }
    },
    [addGdtLog, verifyAndSetPermission, upsertPatientMutation, openPatientTab],
  );

  useEffect(() => {
    if (gdtDirectoryHandle && gdtDirPermission === "granted") {
      addGdtLog(
        `🚀 Starting FileSystemObserver monitoring in "${gdtDirectoryHandle.name}".`,
      );

      // Check if FileSystemObserver is supported
      if (!window.FileSystemObserver) {
        addGdtLog(
          "❌ FileSystemObserver API not supported. Falling back to error state.",
        );
        setGdtDirPermission("error");
        return;
      }

      let isObserverActive = true;

      const setupObserver = async () => {
        try {
          // Create FileSystemObserver with callback
          const observer = new window.FileSystemObserver(
            async (records, observer) => {
              if (!isObserverActive || !gdtDirectoryHandle) {
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
                    `ℹ️ Perm for "${gdtDirectoryHandle.name}" changed during observation: '${gdtDirPermission || "unknown"}' -> '${currentPermission}'.`,
                  );
                  setGdtDirPermission(currentPermission);

                  // Store updated permission in IndexedDB
                  try {
                    await idbSet(IDB_GDT_PERMISSION_KEY, {
                      handleName: gdtDirectoryHandle.name,
                      permission: currentPermission,
                      timestamp: Date.now(),
                      context: "FileSystemObserver permission check",
                    });
                  } catch (idbError) {
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
              } catch (err) {
                const errorMsg =
                  err instanceof Error ? err.message : String(err);
                addGdtLog(
                  `❌ Error querying permission in FileSystemObserver for "${gdtDirectoryHandle.name}": ${errorMsg}`,
                );
                // Error logging now handled via IndexDB instead of Convex
                setGdtDirPermission("error");

                // Store error state in IndexedDB
                try {
                  await idbSet(IDB_GDT_PERMISSION_KEY, {
                    handleName: gdtDirectoryHandle.name,
                    permission: "error",
                    timestamp: Date.now(),
                    context: "FileSystemObserver permission query error",
                    errorMessage: errorMsg,
                  });
                } catch (idbError) {
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
                  fileName &&
                  fileName.toLowerCase().endsWith(".gdt")
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
                  } catch (err) {
                    const errorMsg =
                      err instanceof Error ? err.message : String(err);
                    addGdtLog(`❌ Error processing detected file: ${errorMsg}`);
                  }
                }
              }
            },
          );

          // Start observing the directory
          await observer.observe(gdtDirectoryHandle, { recursive: false });
          gdtFileObserverRef.current = observer;
          addGdtLog(
            `👁️ FileSystemObserver active for "${gdtDirectoryHandle.name}".`,
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          addGdtLog(
            `❌ Error setting up FileSystemObserver for "${gdtDirectoryHandle.name}": ${errorMsg}`,
          );
          setGdtDirPermission("error");
        }
      };

      setupObserver();

      return () => {
        isObserverActive = false;
        if (gdtFileObserverRef.current) {
          gdtFileObserverRef.current.disconnect();
          gdtFileObserverRef.current = null;
          if (gdtDirectoryHandle) {
            addGdtLog(
              `🛑 FileSystemObserver stopped for "${gdtDirectoryHandle.name}" (component unmount or deps change).`,
            );
          }
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
      return undefined;
    }
  }, [gdtDirectoryHandle, gdtDirPermission, addGdtLog, parseAndProcessGdtFile]);

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
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>API Not Supported</AlertTitle>
            <AlertDescription>
              {gdtError || "FSA not supported."}
            </AlertDescription>
          </Alert>
        )}
        {isFsaSupported && !window.isSecureContext && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Secure Context Required</AlertTitle>
            <AlertDescription>HTTPS or localhost needed.</AlertDescription>
          </Alert>
        )}

        {isFsaSupported && window.isSecureContext && (
          <>
            <div className="flex flex-wrap gap-3 mb-6">
              <Button onClick={selectGdtDirectory} variant="default">
                {gdtDirectoryHandle
                  ? `Change Dir (${gdtDirectoryHandle.name})`
                  : "Select GDT Directory"}
              </Button>
              {gdtDirectoryHandle && (
                <Button onClick={forgetGdtDirectory} variant="destructive">
                  Forget "{gdtDirectoryHandle.name}"
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
                      variant={
                        gdtDirPermission === "granted"
                          ? "secondary"
                          : gdtDirPermission === "denied"
                            ? "destructive"
                            : gdtDirPermission === "error"
                              ? "destructive"
                              : "outline"
                      }
                      className={
                        gdtDirPermission === "granted"
                          ? "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100"
                          : gdtDirPermission === "denied" ||
                              gdtDirPermission === "error"
                            ? ""
                            : "bg-amber-100 text-amber-800 dark:bg-amber-700 dark:text-amber-100"
                      }
                    >
                      {gdtDirPermission || "Unknown"}
                    </Badge>
                    {gdtDirPermission === "prompt" && (
                      <Button
                        onClick={() => {
                          if (gdtDirectoryHandle) {
                            verifyAndSetPermission(
                              gdtDirectoryHandle,
                              true,
                              "user request button",
                            );
                          }
                        }}
                        variant="outline"
                        size="sm"
                      >
                        Request Permission
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
            {gdtDirPermission === "denied" && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>Permission Denied</AlertTitle>
                <AlertDescription>
                  Access denied. Check browser site settings.
                </AlertDescription>
              </Alert>
            )}
            {gdtError && (
              <Alert variant="destructive" className="mb-4">
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
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full flex flex-col"
      >
        <div className="border-b px-6 py-3">
          <TabsList className="h-auto">
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Einstellungen
            </TabsTrigger>
            {patientTabs.map((tab) => (
              <TabsTrigger
                key={`patient-${tab.patientId}`}
                value={`patient-${tab.patientId}`}
                className="flex items-center gap-2 group relative"
              >
                <User className="h-4 w-4" />
                {tab.title}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 ml-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    closePatientTab(tab.patientId);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="settings" className="h-full overflow-auto">
            {settingsContent}
          </TabsContent>

          {patientTabs.map((tab) => (
            <TabsContent
              key={`patient-${tab.patientId}`}
              value={`patient-${tab.patientId}`}
              className="h-full overflow-auto"
            >
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center space-y-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                      <p className="text-muted-foreground">
                        Lade Patientendaten...
                      </p>
                    </div>
                  </div>
                }
              >
                <PatientTab patientId={tab.patientId} />
              </Suspense>
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}

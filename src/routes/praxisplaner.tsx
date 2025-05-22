// src/routes/praxisplaner.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  PermissionState as BrowserPermissionState, // Renamed to avoid conflict
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

// Local type for PermissionState used in this component
type PermissionStatus = BrowserPermissionState | "error" | null;

export const Route = createFileRoute("/praxisplaner")({
  component: PraxisPlanerComponent,
});

const IDB_GDT_HANDLE_KEY = "gdtDirectoryHandle";

function PraxisPlanerComponent() {
  const [isFsaSupported, setIsFsaSupported] = useState<boolean | null>(null);
  const [gdtDirectoryHandle, setGdtDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [gdtDirPermission, setGdtDirPermission] =
    useState<PermissionStatus>(null);
  const [gdtLog, setGdtLog] = useState<string[]>([]);
  const [gdtError, setGdtError] = useState<string | null>(null);
  const gdtPollingIntervalRef = useRef<number | null>(null);
  const [isLoadingHandle, setIsLoadingHandle] = useState(true);

  const saveGdtPreference = useMutation(api.gdtPreferences.save);
  const removeGdtPreference = useMutation(api.gdtPreferences.remove);
  const gdtPreference = useQuery(api.gdtPreferences.get);

  const addProcessedFileMutation = useMutation(api.gdtFiles.addProcessedFile);
  const recentProcessedFiles = useQuery(api.gdtFiles.getRecentProcessedFiles, {
    limit: 50,
  });

  const logPermissionEventMutation = useMutation(
    api.permissionLogs.logPermissionEvent,
  );
  const recentPermissionEvents = useQuery(
    api.permissionLogs.getRecentPermissionEvents,
    { limit: 30 },
  );

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

        await logPermissionEventMutation({
          handleName: handle.name,
          operationType,
          accessMode: "readwrite",
          resultState: resultingPermissionState,
          context: loggingContext,
        });
        addGdtLog(
          `[Perm] Logged to Convex: ${handle.name}, ${operationType}, ${resultingPermissionState}, Ctx: ${loggingContext}`,
        );

        setGdtDirPermission(resultingPermissionState);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Error ${operationType} permission:`, errorMessage);
        addGdtLog(
          `[Perm] ❌ Error ${operationType} 'readwrite' for "${handle.name}": ${errorMessage}. (Ctx: ${loggingContext})`,
        );

        await logPermissionEventMutation({
          handleName: handle.name,
          operationType,
          accessMode: "readwrite",
          resultState: "error",
          context: loggingContext,
          errorMessage: errorMessage,
        });
        addGdtLog(
          `[Perm] Logged ERROR to Convex for "${handle.name}": ${errorMessage}`,
        );

        setGdtDirPermission("error");
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
    [addGdtLog, logPermissionEventMutation],
  );

  useEffect(() => {
    if (isFsaSupported === false || typeof gdtPreference === "undefined") {
      if (isFsaSupported !== null && typeof gdtPreference !== "undefined")
        setIsLoadingHandle(false);
      return;
    }
    const loadPersistedHandle = async () => {
      if (gdtPreference?.directoryName) {
        addGdtLog(
          `Found preference for "${gdtPreference.directoryName}" in Convex.`,
        );
        try {
          const persistedHandle =
            await idbGet<FileSystemDirectoryHandle>(IDB_GDT_HANDLE_KEY);
          if (persistedHandle) {
            addGdtLog(
              `Loaded handle "${persistedHandle.name}" from IndexedDB.`,
            );
            setGdtDirectoryHandle(persistedHandle);
            await verifyAndSetPermission(persistedHandle, true, "initial load");
          } else {
            addGdtLog(
              `No handle in IndexedDB for "${gdtPreference.directoryName}". Re-select needed.`,
            );
            await removeGdtPreference();
            addGdtLog("Cleared stale preference from Convex.");
          }
        } catch (error) {
          console.error("Error loading handle from IndexedDB:", error);
          addGdtLog(
            `Error loading handle: ${error instanceof Error ? error.message : String(error)}`,
          );
          await removeGdtPreference();
        }
      }
      setIsLoadingHandle(false);
    };
    if (isFsaSupported && window.isSecureContext) loadPersistedHandle();
  }, [
    isFsaSupported,
    gdtPreference,
    addGdtLog,
    removeGdtPreference,
    verifyAndSetPermission,
  ]);

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
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await idbSet(IDB_GDT_HANDLE_KEY, handle);
      await saveGdtPreference({ directoryName: handle.name });
      addGdtLog(`Saved handle for "${handle.name}" to IDB & Convex pref.`);
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
    }
  };

  const forgetGdtDirectory = useCallback(async () => {
    if (gdtPollingIntervalRef.current) {
      clearInterval(gdtPollingIntervalRef.current);
      gdtPollingIntervalRef.current = null;
    }
    const name = gdtDirectoryHandle?.name;
    addGdtLog(
      name
        ? `🗑️ Clearing GDT directory: "${name}".`
        : "🗑️ Clearing GDT directory.",
    );
    try {
      await idbDel(IDB_GDT_HANDLE_KEY);
      await removeGdtPreference();
      addGdtLog(
        name
          ? `Removed handle for "${name}" from IDB & Convex.`
          : "Cleared stored handle/preference.",
      );
    } catch (e) {
      addGdtLog(
        `Error forgetting directory: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    setGdtDirectoryHandle(null);
    setGdtDirPermission(null);
  }, [gdtDirectoryHandle, addGdtLog, removeGdtPreference]);

  const parseAndProcessGdtFile = useCallback(
    async (
      dirHandle: FileSystemDirectoryHandle,
      fileHandle: FileSystemFileHandle,
    ) => {
      let fileContent = "";
      const fileName = fileHandle.name;
      const sourceDirName = dirHandle.name;
      let parsedSuccessfullyLocal = false;
      let procErrorMessage: string | undefined = undefined;

      try {
        addGdtLog(`📄 Processing "${fileName}"...`);
        const file = await fileHandle.getFile();
        fileContent = await file.text();
        addGdtLog(
          `📜 Content (100 chars): ${fileContent.substring(0, 100)}...`,
        );

        if (fileContent.includes("8000") && fileContent.includes("8100")) {
          parsedSuccessfullyLocal = true;
          addGdtLog(`✅ Parsed "${fileName}".`);
        } else {
          parsedSuccessfullyLocal = false; // Ensure it's explicitly false
          procErrorMessage = `File "${fileName}" may not be valid GDT.`;
          addGdtLog(`⚠️ ${procErrorMessage}`);
        }

        const processedFilePayload: {
          fileName: string;
          fileContent: string;
          sourceDirectoryName: string;
          gdtParsedSuccessfully: boolean;
          processingErrorMessage?: string;
        } = {
          fileName: fileName,
          fileContent: fileContent,
          sourceDirectoryName: sourceDirName, // Use correct variable
          gdtParsedSuccessfully: parsedSuccessfullyLocal, // Use correct variable
        };
        if (procErrorMessage !== undefined) {
          processedFilePayload.processingErrorMessage = procErrorMessage;
        }
        await addProcessedFileMutation(processedFilePayload);
        addGdtLog(`💾 Stored "${fileName}" in Convex.`);

        await dirHandle.removeEntry(fileName);
        addGdtLog(`🗑️ Deleted "${fileName}".`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        addGdtLog(`❌ Error with "${fileName}": ${errorMsg}`);

        const errorFilePayload: {
          fileName: string;
          fileContent: string;
          sourceDirectoryName: string;
          gdtParsedSuccessfully: boolean;
          processingErrorMessage: string; // Error message is always present here
        } = {
          fileName: fileName,
          fileContent: fileContent || "Could not read content.",
          sourceDirectoryName: sourceDirName, // Use correct variable
          gdtParsedSuccessfully: false,
          processingErrorMessage: `Processing error: ${errorMsg}`,
        };
        await addProcessedFileMutation(errorFilePayload);
        addGdtLog(`💾 Stored error for "${fileName}" in Convex.`);

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
    [addGdtLog, addProcessedFileMutation, verifyAndSetPermission],
  );

  useEffect(() => {
    if (gdtDirectoryHandle && gdtDirPermission === "granted") {
      addGdtLog(`🚀 Starting polling in "${gdtDirectoryHandle.name}".`);
      const POLLING_INTERVAL = 5000;
      const poll = async () => {
        if (!gdtDirectoryHandle) {
          if (gdtPollingIntervalRef.current)
            clearInterval(gdtPollingIntervalRef.current);
          gdtPollingIntervalRef.current = null;
          addGdtLog("🛑 Polling stopped: Directory handle lost.");
          return;
        }
        let currentPermInPoll: BrowserPermissionState;
        try {
          currentPermInPoll = await gdtDirectoryHandle.queryPermission({
            mode: "readwrite",
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          addGdtLog(
            `❌ Error querying perm in poll for "${gdtDirectoryHandle.name}": ${errorMsg}`,
          );
          await logPermissionEventMutation({
            handleName: gdtDirectoryHandle.name,
            operationType: "query",
            accessMode: "readwrite",
            resultState: "error",
            context: "polling query error",
            errorMessage: errorMsg,
          });
          setGdtDirPermission("error");
          if (gdtPollingIntervalRef.current) {
            clearInterval(gdtPollingIntervalRef.current);
            gdtPollingIntervalRef.current = null;
            addGdtLog("🛑 Polling stopped: permission query error.");
          }
          return;
        }

        // Check current gdtDirPermission from React state against the new poll result
        const previousGdtDirPermission = gdtDirPermission; // Capture before potential update
        if (currentPermInPoll !== previousGdtDirPermission) {
          addGdtLog(
            `ℹ️ Perm for "${gdtDirectoryHandle.name}" changed in poll: '${previousGdtDirPermission || "unknown"}' -> '${currentPermInPoll}'. Logging.`,
          );
          setGdtDirPermission(currentPermInPoll); // Update UI state
          await logPermissionEventMutation({
            handleName: gdtDirectoryHandle.name,
            operationType: "query",
            accessMode: "readwrite",
            resultState: currentPermInPoll,
            context: "polling detected change",
          });
        }

        // After potential state update, check the *new* gdtDirPermission
        if (currentPermInPoll !== "granted") {
          if (gdtPollingIntervalRef.current) {
            clearInterval(gdtPollingIntervalRef.current);
            gdtPollingIntervalRef.current = null;
            addGdtLog(
              `🛑 Polling stopped: permission no longer 'granted' (now '${currentPermInPoll}').`,
            );
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
          if (foundGdtFileInPoll)
            addGdtLog(`🔎 Poll completed for "${gdtDirectoryHandle.name}".`);
        } catch (err) {
          addGdtLog(
            `❌ Error during GDT polling file iteration: ${err instanceof Error ? err.message : String(err)}.`,
          );
        }
      };
      poll();
      gdtPollingIntervalRef.current = window.setInterval(
        poll,
        POLLING_INTERVAL,
      );

      return () => {
        if (gdtPollingIntervalRef.current) {
          clearInterval(gdtPollingIntervalRef.current);
          gdtPollingIntervalRef.current = null;
          if (gdtDirectoryHandle) {
            // Check gdtDirectoryHandle from closure for log message
            addGdtLog(
              `🛑 GDT file polling stopped for "${gdtDirectoryHandle.name}" (component unmount or deps change).`,
            );
          }
        }
      };
    } else {
      if (gdtPollingIntervalRef.current) {
        clearInterval(gdtPollingIntervalRef.current);
        gdtPollingIntervalRef.current = null;
        if (gdtDirectoryHandle) {
          // Check gdtDirectoryHandle from closure for log message
          addGdtLog(
            `🛑 Polling not started/stopped for "${gdtDirectoryHandle.name}" (permission: ${gdtDirPermission || "none"}).`,
          );
        }
      }
      return undefined; // Explicit return for the else path
    }
  }, [
    gdtDirectoryHandle,
    gdtDirPermission,
    addGdtLog,
    parseAndProcessGdtFile,
    logPermissionEventMutation,
  ]);

  if (
    isLoadingHandle ||
    isFsaSupported === null ||
    (isFsaSupported && typeof gdtPreference === "undefined")
  ) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <p className="text-lg">Initializing...</p>
      </div>
    );
  }

  return (
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
                          if (gdtDirectoryHandle)
                            verifyAndSetPermission(
                              gdtDirectoryHandle,
                              true,
                              "user request button",
                            );
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

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">💾 Processed Files</CardTitle>
                <CardDescription>Persisted GDT records.</CardDescription>
                <Separator className="my-2" />
              </CardHeader>
              <CardContent>
                {recentProcessedFiles === undefined && (
                  <p className="text-muted-foreground">
                    Loading processed files...
                  </p>
                )}
                {recentProcessedFiles?.length === 0 && (
                  <p className="text-muted-foreground">
                    No files processed yet.
                  </p>
                )}
                {recentProcessedFiles && recentProcessedFiles.length > 0 && (
                  <ScrollArea className="h-80">
                    <div className="p-1 space-y-3">
                      {recentProcessedFiles.map(
                        (file: Doc<"processedGdtFiles">) => (
                          <div
                            key={file._id}
                            className="p-3 border rounded-md bg-muted/50 text-sm"
                          >
                            <div className="flex justify-between items-start">
                              <h4 className="font-semibold">{file.fileName}</h4>
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm">
                                    View
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[60vw] max-h-[80vh] bg-card p-6">
                                  <DialogHeader>
                                    <DialogTitle>{file.fileName}</DialogTitle>
                                    <DialogDescription>
                                      Processed:{" "}
                                      {new Date(
                                        Number(file.processedAt),
                                      ).toLocaleString()}{" "}
                                      from '{file.sourceDirectoryName}'
                                    </DialogDescription>
                                  </DialogHeader>
                                  <ScrollArea className="max-h-[60vh] mt-4 border rounded-md">
                                    <pre className="p-4 text-xs whitespace-pre-wrap break-all">
                                      {file.fileContent}
                                    </pre>
                                  </ScrollArea>
                                  <DialogFooter>
                                    <DialogClose asChild>
                                      <Button type="button" variant="secondary">
                                        Close
                                      </Button>
                                    </DialogClose>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              From: {file.sourceDirectoryName} @{" "}
                              {new Date(
                                Number(file.processedAt),
                              ).toLocaleTimeString()}
                            </p>
                            {file.gdtParsedSuccessfully ? (
                              <p className="mt-1 text-green-600 dark:text-green-400">
                                Status: Successfully Parsed
                              </p>
                            ) : (
                              <p className="mt-1 text-red-600 dark:text-red-400">
                                Status: Processing Issue
                                {file.processingErrorMessage && (
                                  <span className="block text-xs text-muted-foreground italic">
                                    Details: {file.processingErrorMessage}
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">
                  🛡️ Permission Event Log
                </CardTitle>
                <CardDescription>Historical permission checks.</CardDescription>
                <Separator className="my-2" />
              </CardHeader>
              <CardContent>
                {recentPermissionEvents === undefined && (
                  <p className="text-muted-foreground">
                    Loading permission events...
                  </p>
                )}
                {recentPermissionEvents?.length === 0 && (
                  <p className="text-muted-foreground">
                    No permission events logged yet.
                  </p>
                )}
                {recentPermissionEvents &&
                  recentPermissionEvents.length > 0 && (
                    <ScrollArea className="h-72">
                      <div className="p-1 space-y-2 text-xs">
                        {recentPermissionEvents.map(
                          (event: Doc<"permissionEvents">) => (
                            <div
                              key={event._id}
                              className={`p-2 border rounded-md ${event.resultState === "error" ? "border-red-500/50 bg-red-500/5" : event.resultState === "denied" ? "border-amber-500/50 bg-amber-500/5" : "border-border"}`}
                            >
                              <div className="font-mono text-muted-foreground">
                                {new Date(
                                  Number(event.timestamp),
                                ).toLocaleString()}
                              </div>
                              <div>
                                Handle:{" "}
                                <span className="font-semibold">
                                  {event.handleName}
                                </span>
                              </div>
                              <div>
                                Action:{" "}
                                <span className="font-medium">
                                  {event.operationType}
                                </span>{" "}
                                ({event.accessMode}) for context:{" "}
                                <span className="italic">
                                  "{event.context}"
                                </span>
                              </div>
                              <div>
                                Result:{" "}
                                <span
                                  className={`font-bold ${
                                    event.resultState === "granted"
                                      ? "text-green-600 dark:text-green-400"
                                      : event.resultState === "denied"
                                        ? "text-amber-600 dark:text-amber-400"
                                        : event.resultState === "prompt"
                                          ? "text-blue-600 dark:text-blue-400"
                                          : event.resultState === "error"
                                            ? "text-red-600 dark:text-red-400"
                                            : ""
                                  }`}
                                >
                                  {event.resultState.toUpperCase()}
                                </span>
                              </div>
                              {event.errorMessage && (
                                <div className="text-red-700 dark:text-red-400">
                                  Error: {event.errorMessage}
                                </div>
                              )}
                            </div>
                          ),
                        )}
                      </div>
                    </ScrollArea>
                  )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

import { capturePostHogException } from "./posthog-client";

export type SafeErrorContext = Partial<Record<UnsafeTelemetryKey, never>> &
  Record<string, unknown>;

type UnsafeTelemetryKey =
  | "absolutePath"
  | "fileContent"
  | "fullPath"
  | "localPath"
  | "path";

const UNSAFE_TELEMETRY_KEYS = new Set<UnsafeTelemetryKey>([
  "absolutePath",
  "fileContent",
  "fullPath",
  "localPath",
  "path",
]);

export interface GdtFileDiagnosticsInput {
  context: string;
  directoryName?: string | undefined;
  domExceptionName?: string | undefined;
  errorType: string;
  fileContentLength?: number | undefined;
  fileLastModified?: string | undefined;
  fileName?: string | undefined;
  fileSize?: number | undefined;
  fileType?: string | undefined;
  isDOMException?: boolean | undefined;
  operationType?: string | undefined;
}

export function buildGdtFileDiagnostics(
  input: GdtFileDiagnosticsInput,
): SafeErrorContext {
  return sanitizeErrorContext(input as unknown as SafeErrorContext) ?? {};
}

export function captureErrorGlobal(error: unknown, context?: SafeErrorContext) {
  // Skip error tracking in development unless explicitly enabled for testing
  if (import.meta.env.DEV && !import.meta.env["VITE_ENABLE_POSTHOG_IN_DEV"]) {
    console.error("Error (PostHog disabled in dev):", error, context);
    return;
  }

  // Convert error to Error instance if needed
  const errorInstance =
    error instanceof Error ? error : new Error(String(error));

  const safeContext = sanitizeErrorContext(context);

  if (!capturePostHogException(errorInstance, safeContext)) {
    console.error("Error (PostHog not available):", error, safeContext);
  }
}

export function sanitizeErrorContext(
  context: SafeErrorContext | undefined,
): SafeErrorContext | undefined {
  if (!context) {
    return undefined;
  }

  const safeEntries = Object.entries(context).filter(
    ([key]) => !UNSAFE_TELEMETRY_KEYS.has(key as UnsafeTelemetryKey),
  );
  return Object.fromEntries(safeEntries);
}

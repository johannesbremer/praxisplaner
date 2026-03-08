import { err, ok, type Result, ResultAsync } from "neverthrow";

import { captureErrorGlobal } from "./error-tracking";

export interface FrontendError {
  cause?: unknown;
  kind: FrontendErrorKind;
  message: string;
  source: string;
}

export type FrontendErrorKind =
  | "browser_api"
  | "configuration"
  | "invalid_state"
  | "missing_context"
  | "unknown";

const reportedErrorKeys = new Set<string>();

export function browserApiError(
  message: string,
  source: string,
  cause?: unknown,
): FrontendError {
  return createFrontendError("browser_api", message, source, cause);
}

export function captureFrontendError(
  error: FrontendError,
  context?: Record<string, unknown>,
  dedupeKey?: string,
): void {
  const key = dedupeKey ?? `${error.source}:${error.kind}:${error.message}`;
  if (reportedErrorKeys.has(key)) {
    return;
  }

  reportedErrorKeys.add(key);
  captureErrorGlobal(frontendErrorToError(error), {
    ...context,
    frontendErrorKind: error.kind,
    frontendErrorMessage: error.message,
    frontendErrorSource: error.source,
  });
}

export function configurationError(
  message: string,
  source: string,
  cause?: unknown,
): FrontendError {
  return createFrontendError("configuration", message, source, cause);
}

export function createFrontendError(
  kind: FrontendErrorKind,
  message: string,
  source: string,
  cause?: unknown,
): FrontendError {
  return {
    ...(cause === undefined ? {} : { cause }),
    kind,
    message,
    source,
  };
}

export function frontendErrorFromUnknown(
  error: unknown,
  fallback: Omit<FrontendError, "cause">,
): FrontendError {
  if (isFrontendError(error)) {
    return error;
  }

  return {
    ...fallback,
    ...(error === undefined ? {} : { cause: error }),
  };
}

export function frontendErrorToError(error: FrontendError): Error {
  const errorInstance = new Error(error.message, {
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  });
  errorInstance.name = `FrontendError:${error.kind}`;
  return errorInstance;
}

export function invalidStateError(
  message: string,
  source: string,
  cause?: unknown,
): FrontendError {
  return createFrontendError("invalid_state", message, source, cause);
}

export function isFrontendError(error: unknown): error is FrontendError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error &&
    "source" in error
  );
}

export function missingContextError(
  hookName: string,
  providerName: string,
): FrontendError {
  return createFrontendError(
    "missing_context",
    `${hookName} must be used within ${providerName}`,
    hookName,
  );
}

export function resultFromNullable<T>(
  value: null | T | undefined,
  error: FrontendError,
): Result<NonNullable<T>, FrontendError> {
  return value == null ? err(error) : ok(value);
}

export function unknownFrontendError(
  message: string,
  source: string,
  cause?: unknown,
): FrontendError {
  return createFrontendError("unknown", message, source, cause);
}

export function wrapAsyncResult<T>(
  operation: () => Promise<T> | T,
  onError: (error: unknown) => FrontendError,
): ResultAsync<T, FrontendError> {
  return ResultAsync.fromPromise(Promise.resolve().then(operation), onError);
}

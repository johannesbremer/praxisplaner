import { err, ok, type Result } from "neverthrow";

import {
  type FrontendError,
  invalidStateError,
} from "../utils/frontend-errors";

let authReturnToPath: null | string = null;
let authReturnToError: FrontendError | null = null;
let authReturnToPracticeSlug: null | string = null;

export interface AuthReturnToState {
  practiceSlug?: string;
  returnTo: string;
}

export function consumeAuthReturnToPath(): Result<string, FrontendError> {
  return consumeAuthReturnToState().map(({ returnTo }) => returnTo);
}

export function consumeAuthReturnToState(): Result<
  AuthReturnToState,
  FrontendError
> {
  const savedError = authReturnToError;
  const returnTo = authReturnToPath;
  const practiceSlug = authReturnToPracticeSlug;
  authReturnToError = null;
  authReturnToPath = null;
  authReturnToPracticeSlug = null;

  if (savedError) {
    return err(savedError);
  }
  if (!returnTo) {
    return err(
      invalidStateError(
        "Missing WorkOS auth return target.",
        "consumeAuthReturnToPath",
      ),
    );
  }
  if (!isAllowedReturnToPath(returnTo) || returnTo === "/callback") {
    return err(createInvalidReturnTargetError(returnTo));
  }

  return ok({
    ...(practiceSlug ? { practiceSlug } : {}),
    returnTo,
  });
}

export function setAuthReturnToError(error: FrontendError): void {
  authReturnToError = error;
  authReturnToPath = null;
  authReturnToPracticeSlug = null;
}

export function setAuthReturnToPath(
  returnTo: string,
): Result<void, FrontendError> {
  if (!isAllowedReturnToPath(returnTo) || returnTo === "/callback") {
    return err(createInvalidReturnTargetError(returnTo));
  }

  authReturnToError = null;
  authReturnToPath = returnTo;
  authReturnToPracticeSlug = null;
  return ok();
}

export function setAuthReturnToState({
  practiceSlug,
  returnTo,
}: AuthReturnToState): Result<void, FrontendError> {
  if (!isAllowedReturnToPath(returnTo) || returnTo === "/callback") {
    return err(createInvalidReturnTargetError(returnTo));
  }

  authReturnToError = null;
  authReturnToPath = returnTo;
  authReturnToPracticeSlug = practiceSlug ?? null;
  return ok();
}

function createInvalidReturnTargetError(returnTo: string): FrontendError {
  return invalidStateError(
    `Invalid WorkOS auth return target: ${returnTo}`,
    "auth-return-to",
  );
}

function isAllowedReturnToPath(returnTo: string): boolean {
  return returnTo.startsWith("/") && !returnTo.startsWith("//");
}

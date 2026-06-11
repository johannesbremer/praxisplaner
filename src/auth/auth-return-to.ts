import { err, ok, type Result } from "neverthrow";

import {
  type FrontendError,
  invalidStateError,
} from "../utils/frontend-errors";

let authReturnToPath: null | string = null;
let authReturnToError: FrontendError | null = null;

export function consumeAuthReturnToPath(): Result<string, FrontendError> {
  const savedError = authReturnToError;
  const returnTo = authReturnToPath;
  authReturnToError = null;
  authReturnToPath = null;

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

  return ok(returnTo);
}

export function setAuthReturnToError(error: FrontendError): void {
  authReturnToError = error;
  authReturnToPath = null;
}

export function setAuthReturnToPath(
  returnTo: string,
): Result<void, FrontendError> {
  if (!isAllowedReturnToPath(returnTo) || returnTo === "/callback") {
    return err(createInvalidReturnTargetError(returnTo));
  }

  authReturnToError = null;
  authReturnToPath = returnTo;
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

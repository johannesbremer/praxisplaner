const BOOKING_PATH = "/buchung";

let authReturnToPath: null | string = null;

export function consumeAuthReturnToPath(): string {
  const returnTo = authReturnToPath;
  authReturnToPath = null;
  return returnTo && isAllowedReturnToPath(returnTo) && returnTo !== "/callback"
    ? returnTo
    : BOOKING_PATH;
}

export function setAuthReturnToPath(returnTo: string): void {
  if (isAllowedReturnToPath(returnTo)) {
    authReturnToPath = returnTo;
  }
}

function isAllowedReturnToPath(returnTo: string): boolean {
  return returnTo.startsWith("/") && !returnTo.startsWith("//");
}

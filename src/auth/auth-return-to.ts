const DEFAULT_RETURN_PATH = "/";
const STORAGE_KEY = "praxisplaner.auth.returnTo";

let authReturnToPath: null | string = null;

export function consumeAuthReturnToPath(): string {
  const returnTo = authReturnToPath ?? readStoredAuthReturnToPath();
  authReturnToPath = null;
  clearStoredAuthReturnToPath();
  return returnTo && isAllowedReturnToPath(returnTo) && returnTo !== "/callback"
    ? returnTo
    : DEFAULT_RETURN_PATH;
}

export function setAuthReturnToPath(returnTo: string): void {
  if (isAllowedReturnToPath(returnTo)) {
    authReturnToPath = returnTo;
    writeStoredAuthReturnToPath(returnTo);
  }
}

function clearStoredAuthReturnToPath(): void {
  if (import.meta.env.SSR) {
    return;
  }
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Browser storage access can be denied by privacy settings.
  }
}

function isAllowedReturnToPath(returnTo: string): boolean {
  return returnTo.startsWith("/") && !returnTo.startsWith("//");
}

function readStoredAuthReturnToPath(): null | string {
  if (import.meta.env.SSR) {
    return null;
  }
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredAuthReturnToPath(returnTo: string): void {
  if (import.meta.env.SSR) {
    return;
  }
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, returnTo);
  } catch {
    // AuthKit state still carries returnTo when storage persistence is blocked.
  }
}

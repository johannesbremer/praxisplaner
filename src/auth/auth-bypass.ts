export function isAuthBypassEnabled(): boolean {
  if (import.meta.env.DEV) {
    return true;
  }

  const bypassFlag = import.meta.env["VITE_AUTH_BYPASS_ENABLED"] === "true";
  if (!bypassFlag) {
    return false;
  }

  const vercelEnv = import.meta.env["VITE_VERCEL_ENV"] as string | undefined;
  return vercelEnv === "preview";
}

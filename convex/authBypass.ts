export function isConvexAuthBypassEnabled(): boolean {
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true") {
    return false;
  }
  const bypassEnabled = process.env["AUTH_BYPASS_ENABLED"] === "true";
  if (!bypassEnabled) {
    return false;
  }
  return (
    process.env["VERCEL_ENV"] !== "production" &&
    process.env["VITE_VERCEL_ENV"] !== "production"
  );
}

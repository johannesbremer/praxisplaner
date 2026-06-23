export function isAuthBypassAllowed(): boolean {
  if (process.env["AUTH_BYPASS_ENABLED"] !== "true") {
    return false;
  }

  const vercelEnv = process.env["VERCEL_ENV"];
  const viteVercelEnv = process.env["VITE_VERCEL_ENV"];

  if (vercelEnv === "production" || viteVercelEnv === "production") {
    throw new Error("AUTH_BYPASS_ENABLED is not allowed in production.");
  }

  return vercelEnv === "preview" || viteVercelEnv === "preview";
}

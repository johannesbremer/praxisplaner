// convex/auth.config.ts
const clientId = process.env["WORKOS_CLIENT_ID"];

if (!clientId) {
  throw new Error(
    "Missing WORKOS_CLIENT_ID environment variable. Auth configuration requires this to be set.",
  );
}

const authConfig = {
  providers: [
    {
      algorithm: "RS256" as const,
      applicationID: clientId,
      issuer: `https://api.workos.com/`,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      type: "customJwt" as const,
    },
    {
      algorithm: "RS256" as const,
      issuer: `https://api.workos.com/user_management/${clientId}`,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      type: "customJwt" as const,
    },
  ],
};

export default authConfig;

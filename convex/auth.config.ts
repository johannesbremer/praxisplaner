// convex/auth.config.ts
const clientId = process.env["WORKOS_CLIENT_ID"];

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

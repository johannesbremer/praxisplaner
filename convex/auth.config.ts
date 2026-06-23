// convex/auth.config.ts
const authBypassEnabled = process.env["AUTH_BYPASS_ENABLED"] === "true";
const clientId =
  process.env["WORKOS_CLIENT_ID"] ??
  (authBypassEnabled ? "client_local_preview_placeholder" : undefined);

if (!clientId) {
  throw new Error(
    "Missing WORKOS_CLIENT_ID environment variable. Auth configuration requires this to be set.",
  );
}

const workOSClientId = clientId;

const workOSProviders = [
  {
    algorithm: "RS256" as const,
    applicationID: workOSClientId,
    issuer: `https://api.workos.com/`,
    jwks: `https://api.workos.com/sso/jwks/${workOSClientId}`,
    type: "customJwt" as const,
  },
  {
    algorithm: "RS256" as const,
    issuer: `https://api.workos.com/user_management/${workOSClientId}`,
    jwks: `https://api.workos.com/sso/jwks/${workOSClientId}`,
    type: "customJwt" as const,
  },
];

const devAuthProvider = {
  algorithm: "RS256" as const,
  applicationID: "praxisplaner-dev",
  issuer: "https://praxisplaner.local/dev-auth",
  jwks: "data:text/plain;charset=utf-8;base64,eyJrZXlzIjpbeyJrdHkiOiJSU0EiLCJuIjoidXdvU2hINWhtMkFrbWczNFU2OTdmMXZ4VGlZY3dkamJsMnJwYndSQVp4Z3JHLXc1dGxNOElvZW90WGh0R2g3SGZzZzVJeDloZDhPWkNPR3dRdjZhMkxBS09NYzJkVDdXWWgxVGMwd3ltVHdYMXdscXpSekJIODZkNFY2M3R5V0xfNWtBdXNCMXFDNy00SkZ1VUxGMFZhcl9NMHlRYndWdjUtR0RoMVp1ZWZFX084ZWlUczhZd1I2S05NZmFNTHI0b0ZVdk5WcldBMGdQQlVSLTBzQ0lsazVGYktlQkVLQ0NJZXRzQVpOSU5NNXp5akJhaHF5QVJEcVBOTHBVXzhOek8ydXUwTnB5YjVZUHU4Wk5LMmg5NWhNaDVjVGFCMUVHZ3VCMjZGXzMwbUtubXFIYlBIRlNBSFpHaVA0YlF4cno4TEh3SkVtR3ViTzRwZ25mN0JNZkV3IiwiZSI6IkFRQUIiLCJhbGciOiJSUzI1NiIsImtpZCI6InByYXhpc3BsYW5lci1kZXYtYXV0aC0yMDI2LTA2IiwidXNlIjoic2lnIn1dfQ==",
  type: "customJwt" as const,
};

const devAuthProviderEnabled = workOSClientId.startsWith("client_local_");

const providers = devAuthProviderEnabled
  ? [...workOSProviders, devAuthProvider]
  : workOSProviders;

const authConfig = {
  providers,
};

export default authConfig;

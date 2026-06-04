/// <reference types="vite/client" />
process.env["WORKOS_API_KEY"] ??= "sk_test_convex";
process.env["WORKOS_CLIENT_ID"] ??= "client_test_convex";
process.env["WORKOS_WEBHOOK_SECRET"] ??= "whsec_test_convex";

export const modules = import.meta.glob([
  "../**/*.{js,ts}",
  "!../tests/**",
  "!../**/*.d.ts",
]);

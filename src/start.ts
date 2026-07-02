import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";

seedVercelPreviewAuthKitEnvironment();

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, authkitMiddleware()],
}));

function getVercelPreviewWorkOSRedirectUri() {
  const vercelUrl = process.env["VERCEL_URL"];
  if (vercelUrl) {
    return `https://${vercelUrl}/api/auth/callback`;
  }
  return "http://localhost:3000/api/auth/callback";
}

function seedVercelPreviewAuthKitEnvironment() {
  if (process.env["VERCEL_ENV"] !== "preview") {
    return;
  }

  process.env["AUTH_BYPASS_ENABLED"] ??= "true";
  process.env["WORKOS_API_KEY"] ??= "sk_test_local_preview_placeholder";
  process.env["WORKOS_CLIENT_ID"] ??= "client_local_preview_placeholder";
  process.env["WORKOS_COOKIE_PASSWORD"] ??=
    "local_preview_cookie_password_32_chars";
  process.env["WORKOS_REDIRECT_URI"] ??= getVercelPreviewWorkOSRedirectUri();
  process.env["WORKOS_WEBHOOK_SECRET"] ??= "whsec_local_preview_placeholder";
}

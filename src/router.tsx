// src/router.tsx
import type { ErrorComponentProps } from "@tanstack/react-router";

import { ConvexQueryClient } from "@convex-dev/react-query";
import {
  MutationCache,
  notifyManager,
  QueryClient,
} from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { ConvexProviderWithAuth } from "convex/react";
import { err, ok, type Result } from "neverthrow";
import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import toast from "react-hot-toast";

import type { FileRouteTypes } from "./routeTree.gen";

import {
  createDevAuthJwt,
  getDevAuthPersonaForPath,
} from "./auth/dev-auth-jwt";
import { routeTree } from "./routeTree.gen";
import { captureErrorGlobal } from "./utils/error-tracking";
import {
  captureFrontendError,
  configurationError,
  type FrontendError,
  missingContextError,
  resultFromNullable,
} from "./utils/frontend-errors";

// Type-safe WorkOS callback route path
const CALLBACK_PATH = "/callback" as const satisfies FileRouteTypes["to"];
const DEV_WORKOS_CLIENT_ID = "client_praxisplaner_dev";
interface RouterConfig {
  convexUrl: string;
  redirectUri: string;
  workosClientId: string;
}

function getSiteOrigin(): Result<string, FrontendError> {
  const fromEnv = import.meta.env["VITE_CONVEX_SITE_URL"] as string | undefined;
  if (!import.meta.env.SSR) {
    return ok(globalThis.window.location.origin);
  }
  if (fromEnv) {
    return ok(fromEnv);
  }
  return err(
    configurationError(
      "Missing VITE_CONVEX_SITE_URL for SSR redirectUri construction",
      "getSiteOrigin",
    ),
  );
}

// WorkOS AuthKit configuration
function getConvexUrl(): Result<string, FrontendError> {
  const convexUrl = import.meta.env["VITE_CONVEX_URL"] as string | undefined;
  return resultFromNullable(
    convexUrl,
    configurationError(
      "VITE_CONVEX_URL environment variable is required",
      "getConvexUrl",
    ),
  );
}

function getRouterConfig(): Result<RouterConfig, FrontendError> {
  return getSiteOrigin().andThen((siteOrigin) =>
    getWorkOSClientId().andThen((workosClientId) =>
      getConvexUrl().map((convexUrl) => ({
        convexUrl,
        redirectUri: new URL(CALLBACK_PATH, siteOrigin).toString(),
        workosClientId,
      })),
    ),
  );
}

function getWorkOSClientId(): Result<string, FrontendError> {
  const clientId = (
    import.meta.env["VITE_WORKOS_CLIENT_ID"] as string | undefined
  )?.trim();
  if (clientId) {
    return ok(clientId);
  }
  if (isWorkOSDevModeEnabled()) {
    return ok(DEV_WORKOS_CLIENT_ID);
  }
  return resultFromNullable(
    clientId,
    configurationError(
      "Missing required environment variable: VITE_WORKOS_CLIENT_ID",
      "getWorkOSClientId",
    ),
  );
}

// Context for sharing ConvexQueryClient with the Wrap component
const ConvexQueryClientContext = createContext<ConvexQueryClient | null>(null);

export function getRouter() {
  if (typeof document !== "undefined") {
    notifyManager.setScheduler(globalThis.requestAnimationFrame);
  }

  const routerConfig = getRouterConfig();
  const convexQueryClient = routerConfig.match(
    ({ convexUrl }) => new ConvexQueryClient(convexUrl),
    (error) => {
      captureFrontendError(error, { context: "Router configuration" });
      return null;
    },
  );

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      ...(convexQueryClient
        ? {
            queries: {
              queryFn: convexQueryClient.queryFn(),
              queryKeyHashFn: convexQueryClient.hashFn(),
            },
          }
        : {}),
    },
    mutationCache: new MutationCache({
      onError: (error) => {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Ein unbekannter Fehler ist aufgetreten";

        // Capture mutation errors with PostHog
        captureErrorGlobal(error, {
          context: "React Query mutation error",
          errorType: "mutation",
        });

        toast(errorMessage, { className: "bg-red-500 text-white" });
      },
    }),
  });
  convexQueryClient?.connect(queryClient);

  const router = routerWithQueryClient(
    createTanStackRouter({
      context: { queryClient },
      defaultErrorComponent: ({ error, reset }: ErrorComponentProps) => (
        <div style={{ color: "red", padding: "20px", textAlign: "center" }}>
          <h1>Etwas ist schiefgelaufen!</h1>
          <p>{error instanceof Error ? error.message : String(error)}</p>
          <button
            onClick={reset}
            style={{ marginTop: "10px", padding: "8px 16px" }}
          >
            Erneut versuchen
          </button>
        </div>
      ),
      defaultNotFoundComponent: () => (
        <div style={{ padding: "20px", textAlign: "center" }}>
          <h1>404 – Seite nicht gefunden</h1>
          <p>Die von Ihnen angeforderte Seite existiert nicht.</p>
        </div>
      ),
      defaultPreload: "viewport",
      routeTree,
      Wrap: ({ children }) => (
        <ConvexQueryClientContext.Provider value={convexQueryClient}>
          {routerConfig.match(
            ({ redirectUri, workosClientId }) => (
              <AuthProviders
                clientId={workosClientId}
                redirectUri={redirectUri}
              >
                {children}
              </AuthProviders>
            ),
            (error) => (
              <FatalConfigScreen error={error} />
            ),
          )}
        </ConvexQueryClientContext.Provider>
      ),
    }),
    queryClient,
  );

  return router;
}

function AuthProviders({
  children,
  clientId,
  redirectUri,
}: {
  children: React.ReactNode;
  clientId: string;
  redirectUri: string;
}) {
  return useConvexQueryClient().match(
    (convexQueryClient) => (
      <AuthProvidersInner
        clientId={clientId}
        convexQueryClient={convexQueryClient}
        redirectUri={redirectUri}
      >
        {children}
      </AuthProvidersInner>
    ),
    (error) => {
      captureFrontendError(error, undefined, "auth-providers-convex-context");
      return (
        <FatalConfigScreen
          error={configurationError(error.message, error.source, error.cause)}
        />
      );
    },
  );
}

function AuthProvidersInner({
  children,
  clientId,
  convexQueryClient,
  redirectUri,
}: {
  children: React.ReactNode;
  clientId: string;
  convexQueryClient: ConvexQueryClient;
  redirectUri: string;
}) {
  const pathname = useBrowserPathname();
  const useRouteScopedConvexAuth = useMemo(() => {
    return function useRouteScopedConvexAuth() {
      return useConvexAuthFromWorkOS(pathname);
    };
  }, [pathname]);

  return (
    <AuthKitProvider
      clientId={clientId}
      devMode={isWorkOSDevModeEnabled()}
      redirectUri={redirectUri}
    >
      <ConvexProviderWithAuth
        client={convexQueryClient.convexClient}
        useAuth={useRouteScopedConvexAuth}
      >
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

function FatalConfigScreen({ error }: { error: FrontendError }) {
  return (
    <div style={{ color: "red", padding: "20px", textAlign: "center" }}>
      <h1>Konfigurationsfehler</h1>
      <p>{error.message}</p>
    </div>
  );
}

function isWorkOSDevModeEnabled(): boolean {
  const vercelEnv = import.meta.env["VITE_VERCEL_ENV"] as string | undefined;
  return import.meta.env.DEV || vercelEnv === "preview";
}

function useBrowserPathname(): string {
  const [pathname, setPathname] = useState(() =>
    import.meta.env.SSR ? "/buchung" : globalThis.location.pathname,
  );

  useEffect(() => {
    const updatePathname = () => {
      setPathname(globalThis.location.pathname);
    };
    const originalPushState = globalThis.history.pushState.bind(
      globalThis.history,
    );
    const originalReplaceState = globalThis.history.replaceState.bind(
      globalThis.history,
    );

    globalThis.history.pushState = function pushState(...args) {
      originalPushState(...args);
      updatePathname();
    };
    globalThis.history.replaceState = function replaceState(...args) {
      originalReplaceState(...args);
      updatePathname();
    };
    globalThis.addEventListener("popstate", updatePathname);
    updatePathname();

    return () => {
      globalThis.history.pushState = originalPushState;
      globalThis.history.replaceState = originalReplaceState;
      globalThis.removeEventListener("popstate", updatePathname);
    };
  }, []);

  return pathname;
}

function useConvexQueryClient(): Result<ConvexQueryClient, FrontendError> {
  const client = useContext(ConvexQueryClientContext);
  return resultFromNullable(
    client,
    missingContextError("useConvexQueryClient", "ConvexQueryClientContext"),
  );
}

/**
 * Adapts WorkOS AuthKit's useAuth hook for Convex's ConvexProviderWithAuth.
 * This is a proper adapter that matches Convex's expected interface.
 */
function isAuthBypassEnabled(): boolean {
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

function useConvexAuthFromWorkOS(pathname: string) {
  const { getAccessToken, isLoading, user } = useAuth();

  const fetchAccessToken = useCallback(
    async ({
      forceRefreshToken,
    }: {
      forceRefreshToken: boolean;
    }): Promise<null | string> => {
      if (isAuthBypassEnabled()) {
        return await createDevAuthJwt(getDevAuthPersonaForPath(pathname));
      }
      if (isLoading) {
        return null;
      }
      if (!user) {
        return null;
      }
      try {
        const token = await getAccessToken({ forceRefresh: forceRefreshToken });
        return token || null;
      } catch (error) {
        console.error("Error fetching access token:", error);
        return null;
      }
    },
    [isLoading, pathname, user, getAccessToken],
  );

  return useMemo(
    () => ({
      fetchAccessToken,
      isAuthenticated: isAuthBypassEnabled() || !!user,
      isLoading: isAuthBypassEnabled() ? false : isLoading,
    }),
    [isLoading, user, fetchAccessToken],
  );
}

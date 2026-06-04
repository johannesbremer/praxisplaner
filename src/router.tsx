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

import { isAuthBypassEnabled } from "./auth/auth-bypass";
import {
  setAuthReturnToError,
  setAuthReturnToPath,
} from "./auth/auth-return-to";
import {
  createDevAuthJwt,
  type DevAuthPersona,
  getDevAuthPersonaForPath,
} from "./auth/dev-auth-jwt";
import { routeTree } from "./routeTree.gen";
import { captureErrorGlobal } from "./utils/error-tracking";
import {
  captureFrontendError,
  configurationError,
  type FrontendError,
  invalidStateError,
  missingContextError,
  resultFromNullable,
} from "./utils/frontend-errors";

// Type-safe WorkOS callback route path
const CALLBACK_PATH = "/callback" as const satisfies FileRouteTypes["to"];
const DEV_WORKOS_CLIENT_ID = "client_praxisplaner_dev";
const DEV_AUTH_TOKEN_REFRESH_AFTER_MS = 4 * 60 * 1000;

interface DevAuthTokenState {
  persona: DevAuthPersona;
  refreshAfterMs: number;
  token: string;
}

interface RouterConfig {
  apiHostname?: string;
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
      getWorkOSApiHostname().andThen((apiHostnameConfig) =>
        getConvexUrl().map((convexUrl) => ({
          ...apiHostnameConfig,
          convexUrl,
          redirectUri: new URL(CALLBACK_PATH, siteOrigin).toString(),
          workosClientId,
        })),
      ),
    ),
  );
}

function getWorkOSApiHostname(): Result<
  Pick<RouterConfig, "apiHostname">,
  FrontendError
> {
  const apiHostname = (
    import.meta.env["VITE_WORKOS_API_HOSTNAME"] as string | undefined
  )?.trim();
  if (apiHostname && !isInvalidWorkOSApiHostname(apiHostname)) {
    return ok({ apiHostname });
  }
  if (!apiHostname) {
    return ok({});
  }
  return err(
    configurationError(
      "VITE_WORKOS_API_HOSTNAME must be a WorkOS Authentication API hostname, not an AuthKit app URL.",
      "getWorkOSApiHostname",
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

function isInvalidWorkOSApiHostname(apiHostname: string): boolean {
  return (
    apiHostname.includes("://") ||
    apiHostname.includes("/") ||
    apiHostname.endsWith(".authkit.app")
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

        toast(errorMessage, {
          className: "bg-destructive text-destructive-foreground",
        });
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
      defaultPreload: false,
      routeTree,
      Wrap: ({ children }) => (
        <ConvexQueryClientContext.Provider value={convexQueryClient}>
          {routerConfig.match(
            ({ apiHostname, redirectUri, workosClientId }) => (
              <AuthProviders
                {...(apiHostname ? { apiHostname } : {})}
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
  apiHostname,
  children,
  clientId,
  redirectUri,
}: {
  apiHostname?: string;
  children: React.ReactNode;
  clientId: string;
  redirectUri: string;
}) {
  return useConvexQueryClient().match(
    (convexQueryClient) => (
      <AuthProvidersInner
        {...(apiHostname ? { apiHostname } : {})}
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
  apiHostname,
  children,
  clientId,
  convexQueryClient,
  redirectUri,
}: {
  apiHostname?: string;
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
      {...(apiHostname ? { apiHostname } : {})}
      clientId={clientId}
      devMode={isWorkOSDevModeEnabled()}
      onRedirectCallback={storeAuthReturnTo}
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

async function createDevAuthTokenState(
  persona: DevAuthPersona,
): Promise<DevAuthTokenState> {
  const token = await createDevAuthJwt(persona);
  return {
    persona,
    refreshAfterMs: Date.now() + DEV_AUTH_TOKEN_REFRESH_AFTER_MS,
    token,
  };
}

function FatalConfigScreen({ error }: { error: FrontendError }) {
  return (
    <div style={{ color: "red", padding: "20px", textAlign: "center" }}>
      <h1>Konfigurationsfehler</h1>
      <p>{error.message}</p>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkOSDevModeEnabled(): boolean {
  const vercelEnv = import.meta.env["VITE_VERCEL_ENV"] as string | undefined;
  return import.meta.env.DEV || vercelEnv === "preview";
}

function storeAuthReturnTo({ state }: { state?: unknown }) {
  if (import.meta.env.SSR) {
    return;
  }
  if (!isRecord(state)) {
    setAuthReturnToError(
      invalidStateError("WorkOS callback state is missing.", "router"),
    );
    return;
  }
  const returnTo = state["returnTo"];
  if (typeof returnTo !== "string") {
    setAuthReturnToError(
      invalidStateError("WorkOS callback state is missing returnTo.", "router"),
    );
    return;
  }
  setAuthReturnToPath(returnTo).match(
    () => true,
    (error) => {
      setAuthReturnToError(error);
      return false;
    },
  );
}

function useBrowserPathname(): string {
  const [pathname, setPathname] = useState(() =>
    import.meta.env.SSR ? "/" : globalThis.location.pathname,
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

function useConvexAuthFromWorkOS(pathname: string) {
  const { getAccessToken, isLoading, user } = useAuth();
  const authBypassEnabled = isAuthBypassEnabled();
  const devPersona = getDevAuthPersonaForPath(pathname);
  const userId = user?.id ?? null;
  const [accessTokenReadyUserId, setAccessTokenReadyUserId] = useState<
    null | string
  >(null);
  const [devAuthToken, setDevAuthToken] = useState<DevAuthTokenState | null>(
    null,
  );

  useEffect(() => {
    if (!authBypassEnabled) {
      return;
    }

    let active = true;
    void createDevAuthTokenState(devPersona).then(
      (tokenState) => {
        if (active) {
          setDevAuthToken(tokenState);
        }
      },
      (error: unknown) => {
        if (active) {
          console.error("Error creating dev auth token:", error);
          setDevAuthToken(null);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [authBypassEnabled, devPersona]);

  useEffect(() => {
    if (authBypassEnabled) {
      return;
    }
    if (isLoading || !userId) {
      return;
    }

    let active = true;
    void getAccessToken().then(
      (token) => {
        if (active) {
          setAccessTokenReadyUserId(token ? userId : null);
        }
      },
      (error: unknown) => {
        if (active) {
          console.error("Error preparing access token:", error);
          setAccessTokenReadyUserId(null);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [authBypassEnabled, getAccessToken, isLoading, userId]);

  const fetchAccessToken = useCallback(async (): Promise<null | string> => {
    if (authBypassEnabled) {
      if (
        devAuthToken?.persona === devPersona &&
        devAuthToken.refreshAfterMs > Date.now()
      ) {
        return devAuthToken.token;
      }

      const tokenState = await createDevAuthTokenState(devPersona);
      setDevAuthToken(tokenState);
      return tokenState.token;
    }
    if (isLoading) {
      return null;
    }
    if (!user) {
      return null;
    }
    try {
      const token = await getAccessToken();
      return token || null;
    } catch (error) {
      console.error("Error fetching access token:", error);
      return null;
    }
  }, [
    authBypassEnabled,
    devAuthToken,
    devPersona,
    getAccessToken,
    isLoading,
    user,
  ]);

  const devAuthReady =
    authBypassEnabled && devAuthToken?.persona === devPersona;
  const accessTokenReady = userId !== null && accessTokenReadyUserId === userId;

  return useMemo(
    () => ({
      fetchAccessToken,
      isAuthenticated: authBypassEnabled ? devAuthReady : accessTokenReady,
      isLoading: authBypassEnabled
        ? !devAuthReady
        : isLoading || (userId !== null && !accessTokenReady),
    }),
    [
      accessTokenReady,
      authBypassEnabled,
      devAuthReady,
      fetchAccessToken,
      isLoading,
      userId,
    ],
  );
}

function useConvexQueryClient(): Result<ConvexQueryClient, FrontendError> {
  const client = useContext(ConvexQueryClientContext);
  return resultFromNullable(
    client,
    missingContextError("useConvexQueryClient", "ConvexQueryClientContext"),
  );
}

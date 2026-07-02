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
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos/authkit-tanstack-react-start/client";
import { ConvexProviderWithAuth } from "convex/react";
import { type Result } from "neverthrow";
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

import { isAuthBypassEnabled } from "./auth/auth-bypass";
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
  missingContextError,
  resultFromNullable,
} from "./utils/frontend-errors";

const DEV_AUTH_TOKEN_REFRESH_AFTER_MS = 4 * 60 * 1000;

interface DevAuthTokenState {
  persona: DevAuthPersona;
  refreshAfterMs: number;
  token: string;
}

interface RouterConfig {
  convexUrl: string;
}

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
  return getConvexUrl().map((convexUrl) => ({ convexUrl }));
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
            () => (
              <AuthProviders>{children}</AuthProviders>
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

function AuthProviders({ children }: { children: React.ReactNode }) {
  return useConvexQueryClient().match(
    (convexQueryClient) => (
      <AuthProvidersInner convexQueryClient={convexQueryClient}>
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
  convexQueryClient,
}: {
  children: React.ReactNode;
  convexQueryClient: ConvexQueryClient;
}) {
  const pathname = useBrowserPathname();
  const useRouteScopedConvexAuth = useMemo(() => {
    return function useRouteScopedConvexAuth() {
      return useConvexAuthFromWorkOS(pathname);
    };
  }, [pathname]);

  return (
    <AuthKitProvider>
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
  const { getAccessToken } = useAccessToken();
  const { loading, user } = useAuth();
  const authBypassEnabled = isAuthBypassEnabled();
  const devPersona = getDevAuthPersonaForPath(pathname);
  const userId = user?.id ?? null;
  const [accessTokenReadyUserId, setAccessTokenReadyUserId] = useState<
    null | string
  >(null);
  const [accessTokenUnavailableUserId, setAccessTokenUnavailableUserId] =
    useState<null | string>(null);
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
    if (loading || !userId) {
      return;
    }

    let active = true;
    void getAccessToken().then(
      (token) => {
        if (active) {
          setAccessTokenReadyUserId(token ? userId : null);
          setAccessTokenUnavailableUserId(token ? null : userId);
        }
      },
      (error: unknown) => {
        if (active) {
          console.error("Error preparing access token:", error);
          setAccessTokenReadyUserId(null);
          setAccessTokenUnavailableUserId(userId);
        }
      },
    );

    return () => {
      active = false;
    };
  }, [authBypassEnabled, getAccessToken, loading, userId]);

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
    if (loading) {
      return null;
    }
    if (!user) {
      return null;
    }
    try {
      const token = await getAccessToken();
      setAccessTokenReadyUserId(token ? user.id : null);
      setAccessTokenUnavailableUserId(token ? null : user.id);
      return token || null;
    } catch (error) {
      console.error("Error fetching access token:", error);
      setAccessTokenReadyUserId(null);
      setAccessTokenUnavailableUserId(user.id);
      return null;
    }
  }, [
    authBypassEnabled,
    devAuthToken,
    devPersona,
    getAccessToken,
    loading,
    user,
  ]);

  const devAuthReady =
    authBypassEnabled && devAuthToken?.persona === devPersona;
  const accessTokenReady = userId !== null && accessTokenReadyUserId === userId;
  const accessTokenUnavailable =
    userId !== null && accessTokenUnavailableUserId === userId;

  return useMemo(
    () => ({
      fetchAccessToken,
      isAuthenticated: authBypassEnabled ? devAuthReady : accessTokenReady,
      isLoading: authBypassEnabled
        ? !devAuthReady
        : loading ||
          (userId !== null && !accessTokenReady && !accessTokenUnavailable),
    }),
    [
      accessTokenReady,
      accessTokenUnavailable,
      authBypassEnabled,
      devAuthReady,
      fetchAccessToken,
      loading,
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

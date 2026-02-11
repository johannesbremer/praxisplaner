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
import * as React from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import toast from "react-hot-toast";

import type { FileRouteTypes } from "./routeTree.gen";

import { routeTree } from "./routeTree.gen";
import { captureErrorGlobal } from "./utils/error-tracking";

// Type-safe WorkOS callback route path
const CALLBACK_PATH = "/callback" as const satisfies FileRouteTypes["to"];

function getSiteOrigin(): string {
  const fromEnv = import.meta.env["VITE_CONVEX_SITE_URL"] as string | undefined;
  if (!import.meta.env.SSR) {
    return globalThis.window.location.origin;
  }
  if (fromEnv) {
    return fromEnv;
  }
  throw new Error(
    "Missing VITE_CONVEX_SITE_URL for SSR redirectUri construction",
  );
}

const WORKOS_REDIRECT_URI = new URL(CALLBACK_PATH, getSiteOrigin()).toString();

// WorkOS AuthKit configuration
function getWorkOSClientId(): string {
  const clientId = import.meta.env["VITE_WORKOS_CLIENT_ID"] as
    | string
    | undefined;
  if (!clientId) {
    throw new Error(
      "Missing required environment variable: VITE_WORKOS_CLIENT_ID",
    );
  }
  return clientId;
}

const WORKOS_CLIENT_ID = getWorkOSClientId();

// Context for sharing ConvexQueryClient with the Wrap component
const ConvexQueryClientContext = createContext<ConvexQueryClient | null>(null);

export function getRouter() {
  if (typeof document !== "undefined") {
    notifyManager.setScheduler(globalThis.requestAnimationFrame);
  }

  const CONVEX_URL = import.meta.env["VITE_CONVEX_URL"] as string | undefined;

  if (!CONVEX_URL) {
    const errorMessage = "VITE_CONVEX_URL environment variable is required";
    const error = new Error(errorMessage);
    captureErrorGlobal(error, {
      context: "Missing CONVEX_URL environment variable",
      errorType: "configuration",
    });

    // For critical configuration errors, we still need to throw as the app cannot function
    // but we've captured the error for monitoring first
    throw error;
  }
  const convexQueryClient = new ConvexQueryClient(CONVEX_URL);

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: convexQueryClient.queryFn(),
        queryKeyHashFn: convexQueryClient.hashFn(),
      },
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
  convexQueryClient.connect(queryClient);

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
          <AuthProviders>{children}</AuthProviders>
        </ConvexQueryClientContext.Provider>
      ),
    }),
    queryClient,
  );

  return router;
}

function AuthProviders({ children }: { children: React.ReactNode }) {
  const convexQueryClient = useConvexQueryClient();

  return (
    <AuthProvidersInner
      convexQueryClient={convexQueryClient}
      redirectUri={WORKOS_REDIRECT_URI}
    >
      {children}
    </AuthProvidersInner>
  );
}

function AuthProvidersInner({
  children,
  convexQueryClient,
  redirectUri,
}: {
  children: React.ReactNode;
  convexQueryClient: ConvexQueryClient;
  redirectUri: string;
}) {
  return (
    <AuthKitProvider
      clientId={WORKOS_CLIENT_ID}
      devMode
      redirectUri={redirectUri}
    >
      <ConvexProviderWithAuth
        client={convexQueryClient.convexClient}
        useAuth={useConvexAuthFromWorkOS}
      >
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

function useConvexQueryClient(): ConvexQueryClient {
  const client = useContext(ConvexQueryClientContext);
  if (!client) {
    throw new Error(
      "useConvexQueryClient must be used within ConvexQueryClientContext",
    );
  }
  return client;
}

/**
 * Adapts WorkOS AuthKit's useAuth hook for Convex's ConvexProviderWithAuth.
 * This is a proper adapter that matches Convex's expected interface.
 */
function useConvexAuthFromWorkOS() {
  const { getAccessToken, isLoading, user } = useAuth();

  const fetchAccessToken = useCallback(
    async ({
      forceRefreshToken,
    }: {
      forceRefreshToken: boolean;
    }): Promise<null | string> => {
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
    [isLoading, user, getAccessToken],
  );

  return useMemo(
    () => ({
      fetchAccessToken,
      isAuthenticated: !!user,
      isLoading,
    }),
    [isLoading, user, fetchAccessToken],
  );
}

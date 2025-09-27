// src/router.tsx
import type { ErrorComponentProps } from "@tanstack/react-router"; // Corrected: type-only import

import { ConvexQueryClient } from "@convex-dev/react-query";
import {
  MutationCache,
  notifyManager,
  QueryClient,
} from "@tanstack/react-query";
import {
  createRouter as createTanStackRouter,
  // ErrorComponentProps, // Changed to type-only import below
} from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { ConvexProvider } from "convex/react";
import toast from "react-hot-toast";

import { routeTree } from "./routeTree.gen";
import { captureErrorGlobal } from "./utils/error-tracking";

export function getRouter() {
  if (typeof document !== "undefined") {
    notifyManager.setScheduler(globalThis.requestAnimationFrame);
  }

  const CONVEX_URL = (import.meta as { env: Record<string, string> }).env[
    "VITE_CONVEX_URL"
  ];

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
      defaultErrorComponent: (
        { error, reset }: ErrorComponentProps, // Type annotation is still valid
      ) => (
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
        <ConvexProvider client={convexQueryClient.convexClient}>
          {children}
        </ConvexProvider>
      ),
    }),
    queryClient,
  );

  return router;
}

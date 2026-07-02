import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useAccessToken,
  useAuth,
} from "@workos/authkit-tanstack-react-start/client";
import { useAction, useConvexAuth } from "convex/react";
import { err, ok, type Result } from "neverthrow";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { Button } from "../../components/ui/button";
import { api } from "../../convex/_generated/api";
import {
  type FrontendError,
  invalidStateError,
} from "../utils/frontend-errors";

const callbackSearchSchema = z.object({
  practiceSlug: z.string().optional(),
  returnTo: z.string().catch("/"),
});
type CallbackSearch = z.infer<typeof callbackSearchSchema>;

export const Route = createFileRoute("/callback")({
  component: CallbackComponent,
  validateSearch: validateCallbackSearch,
});

const CALLBACK_TIMEOUT_MS = 15_000;
const CALLBACK_RETRY_RETURN_TO = "/";
const CONVEX_AUTH_FAILED_MESSAGE =
  "Anmeldung bei Convex konnte nicht abgeschlossen werden. Bitte prüfen Sie die WorkOS Client-ID und Convex Auth-Konfiguration für diese Umgebung.";
const CALLBACK_TIMEOUT_MESSAGE =
  "Anmeldung konnte nicht innerhalb von 15 Sekunden abgeschlossen werden. Bitte prüfen Sie die WorkOS-Tokenausgabe und Convex-Authentifizierung für diese Preview.";

function CallbackComponent() {
  const { getAccessToken } = useAccessToken();
  const { loading, organizationId, user } = useAuth();
  const returnState = validateCallbackSearch(Route.useSearch());
  const convexAuth = useConvexAuth();
  const joinBookingPracticeBySlug = useAction(
    api.workosOrganizations.joinBookingPracticeBySlug,
  );
  const provisionCurrentUser = useAction(
    api.users.provisionCurrentUserFromAuthIdentity,
  );
  const syncCurrentOrganizationMembership = useAction(
    api.workosOrganizations.syncCurrentUserOrganizationMembership,
  );
  const navigate = useNavigate();
  const accessTokenUserIdRef = useRef<null | string>(null);
  const convexAuthErrorLoggedUserIdRef = useRef<null | string>(null);
  const provisioningUserIdRef = useRef<null | string>(null);
  const [accessTokenReadyUserId, setAccessTokenReadyUserId] = useState<
    null | string
  >(null);
  const [accessTokenError, setAccessTokenError] = useState<null | {
    message: string;
    userId: string;
  }>(null);
  const [callbackTimedOutUserId, setCallbackTimedOutUserId] = useState<
    null | string
  >(null);
  const [provisioningError, setProvisioningError] = useState<null | {
    message: string;
    userId: string;
  }>(null);
  const userId = user?.id ?? null;
  const activeAccessTokenError =
    accessTokenError?.userId === userId ? accessTokenError.message : null;
  const activeProvisioningError =
    provisioningError?.userId === userId ? provisioningError.message : null;
  const activeConvexAuthError =
    !loading &&
    user &&
    userId &&
    accessTokenReadyUserId === userId &&
    !convexAuth.isLoading &&
    !convexAuth.isAuthenticated
      ? CONVEX_AUTH_FAILED_MESSAGE
      : null;
  const activeCallbackTimeoutError =
    !loading &&
    user &&
    userId &&
    callbackTimedOutUserId === userId &&
    !activeAccessTokenError &&
    !activeConvexAuthError &&
    !activeProvisioningError
      ? CALLBACK_TIMEOUT_MESSAGE
      : null;
  const resetAuthRetryState = () => {
    accessTokenUserIdRef.current = null;
    convexAuthErrorLoggedUserIdRef.current = null;
    provisioningUserIdRef.current = null;
    setAccessTokenReadyUserId(null);
    setAccessTokenError(null);
    setCallbackTimedOutUserId(null);
    setProvisioningError(null);
  };

  useEffect(() => {
    if (loading || !userId || provisioningUserIdRef.current === userId) {
      return;
    }
    const timeoutId = globalThis.setTimeout(() => {
      logPreviewAuthCallback("timeout", {
        accessTokenReady: accessTokenReadyUserId === userId,
        convexAuthenticated: convexAuth.isAuthenticated,
        convexLoading: convexAuth.isLoading,
      });
      setCallbackTimedOutUserId(userId);
    }, CALLBACK_TIMEOUT_MS);
    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [
    accessTokenReadyUserId,
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    loading,
    userId,
  ]);

  useEffect(() => {
    if (
      !activeConvexAuthError ||
      !userId ||
      convexAuthErrorLoggedUserIdRef.current === userId
    ) {
      return;
    }
    convexAuthErrorLoggedUserIdRef.current = userId;
    logPreviewAuthCallback("convex-auth:error", {
      accessTokenReady: accessTokenReadyUserId === userId,
      convexAuthenticated: convexAuth.isAuthenticated,
      convexLoading: convexAuth.isLoading,
    });
  }, [
    accessTokenReadyUserId,
    activeConvexAuthError,
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    userId,
  ]);

  useEffect(() => {
    if (
      loading ||
      !user ||
      !userId ||
      accessTokenUserIdRef.current === userId ||
      activeAccessTokenError
    ) {
      return;
    }
    accessTokenUserIdRef.current = userId;
    logPreviewAuthCallback("access-token:start", {
      convexAuthenticated: convexAuth.isAuthenticated,
      convexLoading: convexAuth.isLoading,
    });
    getAccessToken()
      .then(() => {
        logPreviewAuthCallback("access-token:success", {
          convexAuthenticated: convexAuth.isAuthenticated,
          convexLoading: convexAuth.isLoading,
        });
        setAccessTokenReadyUserId(userId);
        setAccessTokenError(null);
      })
      .catch((error: unknown) => {
        logPreviewAuthCallback("access-token:error", {
          error: error instanceof Error ? error.message : "unknown",
        });
        accessTokenUserIdRef.current = null;
        setAccessTokenReadyUserId(null);
        setAccessTokenError({
          message:
            error instanceof Error
              ? error.message
              : "Zugriffstoken konnte nicht abgerufen werden.",
          userId,
        });
      });
  }, [
    activeAccessTokenError,
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    getAccessToken,
    loading,
    user,
    userId,
  ]);

  useEffect(() => {
    if (
      loading ||
      !user ||
      !userId ||
      accessTokenReadyUserId !== userId ||
      provisioningUserIdRef.current === userId ||
      activeAccessTokenError ||
      activeCallbackTimeoutError ||
      activeConvexAuthError ||
      activeProvisioningError
    ) {
      return;
    }
    if (convexAuth.isLoading) {
      return;
    }
    logPreviewAuthCallback("provision:start", {
      convexAuthenticated: convexAuth.isAuthenticated,
    });
    provisioningUserIdRef.current = userId;
    readCallbackReturnState({
      ...(returnState.practiceSlug
        ? { practiceSlug: returnState.practiceSlug }
        : {}),
      returnTo: returnState.returnTo,
    }).match(
      ({ practiceSlug, returnTo }) => {
        const backendAction = practiceSlug
          ? joinBookingPracticeBySlug({ practiceSlug })
          : provisionCurrentUser({}).then(() =>
              organizationId
                ? syncCurrentOrganizationMembership({ organizationId })
                : null,
            );
        backendAction
          .then(() => {
            logPreviewAuthCallback(
              practiceSlug
                ? "join-booking-practice:success"
                : organizationId
                  ? "provision-and-sync-organization:success"
                  : "provision:success",
            );
            const result = navigateToReturnPath(navigate, returnTo);
            result.match(
              () => true,
              (error) => {
                provisioningUserIdRef.current = null;
                setProvisioningError({
                  message: error.message,
                  userId,
                });
                return false;
              },
            );
          })
          .catch((error: unknown) => {
            logPreviewAuthCallback("provision:error", {
              error: error instanceof Error ? error.message : "unknown",
            });
            provisioningUserIdRef.current = null;
            setProvisioningError({
              message:
                error instanceof Error
                  ? error.message
                  : "Benutzerkonto konnte nicht angelegt werden.",
              userId,
            });
          });
        return true;
      },
      (error) => {
        globalThis.queueMicrotask(() => {
          provisioningUserIdRef.current = null;
          setProvisioningError({
            message: error.message,
            userId,
          });
        });
        return false;
      },
    );
  }, [
    activeAccessTokenError,
    activeCallbackTimeoutError,
    activeConvexAuthError,
    activeProvisioningError,
    accessTokenReadyUserId,
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    loading,
    joinBookingPracticeBySlug,
    navigate,
    organizationId,
    provisionCurrentUser,
    returnState,
    syncCurrentOrganizationMembership,
    user,
    userId,
  ]);

  // Auth completed but no user - keep retry path only.
  if (!loading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive font-medium">
            Anmeldung fehlgeschlagen
          </p>
          <p className="text-muted-foreground text-sm">
            Die Authentifizierung konnte nicht abgeschlossen werden.
          </p>
          <Button
            onClick={() => {
              redirectToSignIn(CALLBACK_RETRY_RETURN_TO);
            }}
          >
            Erneut anmelden
          </Button>
        </div>
      </div>
    );
  }

  const activeError =
    activeAccessTokenError ??
    activeConvexAuthError ??
    activeProvisioningError ??
    activeCallbackTimeoutError;

  if (activeError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive font-medium">
            Anmeldung fehlgeschlagen
          </p>
          <p className="text-muted-foreground text-sm">{activeError}</p>
          <Button
            onClick={() => {
              resetAuthRetryState();
            }}
          >
            Erneut versuchen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
        <p className="text-muted-foreground">
          Authentifizierung wird abgeschlossen...
        </p>
      </div>
    </div>
  );
}

function createNavigationError(message: string): Result<void, FrontendError> {
  return err(invalidStateError(message, "navigateToReturnPath"));
}

function getSameOriginReturnUrl(returnTo: string): null | URL {
  const returnUrl = new URL(returnTo, globalThis.location.origin);
  return returnUrl.origin === globalThis.location.origin ? returnUrl : null;
}

function isAllowedReturnToPath(returnTo: string): boolean {
  return returnTo.startsWith("/") && !returnTo.startsWith("//");
}

function logPreviewAuthCallback(
  event: string,
  details: Record<string, boolean | string> = {},
): void {
  if (import.meta.env["VITE_VERCEL_ENV"] !== "preview") {
    return;
  }
  console.warn("[auth-callback]", event, details);
}

function navigateToReturnPath(
  navigate: ReturnType<typeof useNavigate>,
  returnTo: string,
): Result<void, FrontendError> {
  const returnUrl = getSameOriginReturnUrl(returnTo);
  if (!returnUrl) {
    return createNavigationError(
      `Cross-origin auth return target: ${returnTo}`,
    );
  }

  const fullPath = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
  switch (returnUrl.pathname) {
    case "/": {
      void navigate({ replace: true, to: fullPath });
      return ok();
    }
    case "/account": {
      void navigate({ replace: true, to: fullPath });
      return ok();
    }
    default: {
      const segments = returnUrl.pathname.split("/").filter(Boolean);
      if (
        segments.length === 1 ||
        (segments.length === 2 &&
          (segments[1] === "praxisplaner" || segments[1] === "regeln")) ||
        (segments.length >= 3 && segments[1] === "praxisplaner")
      ) {
        void navigate({ replace: true, to: fullPath });
        return ok();
      }
      return createNavigationError(
        `Unsupported auth return target: ${fullPath}`,
      );
    }
  }
}

function readCallbackReturnState({
  practiceSlug,
  returnTo,
}: {
  practiceSlug?: string;
  returnTo: string;
}): Result<{ practiceSlug?: string; returnTo: string }, FrontendError> {
  if (!isAllowedReturnToPath(returnTo) || returnTo === "/callback") {
    return err(
      invalidStateError(
        `Invalid WorkOS auth return target: ${returnTo}`,
        "callback",
      ),
    );
  }
  return ok({
    ...(practiceSlug ? { practiceSlug } : {}),
    returnTo,
  });
}

function redirectToSignIn(returnTo: string): void {
  const params = new URLSearchParams({ returnTo });
  globalThis.location.assign(`/api/auth/sign-in?${params.toString()}`);
}

function validateCallbackSearch(search: unknown): CallbackSearch {
  const result = callbackSearchSchema.safeParse(search);
  if (result.success) {
    return result.data;
  }
  return { returnTo: "/" };
}

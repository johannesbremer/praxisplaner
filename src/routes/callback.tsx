import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { api } from "../../convex/_generated/api";
import { consumeAuthReturnToPath } from "../auth/auth-return-to";

export const Route = createFileRoute("/callback")({
  component: CallbackComponent,
});

const BOOKING_PATH = "/buchung";
const CALLBACK_TIMEOUT_MS = 15_000;
const CONVEX_AUTH_FAILED_MESSAGE =
  "Anmeldung bei Convex konnte nicht abgeschlossen werden. Bitte prüfen Sie die WorkOS Client-ID und Convex Auth-Konfiguration für diese Umgebung.";
const CALLBACK_TIMEOUT_MESSAGE =
  "Anmeldung konnte nicht innerhalb von 15 Sekunden abgeschlossen werden. Bitte prüfen Sie die WorkOS-Tokenausgabe und Convex-Authentifizierung für diese Preview.";

function CallbackComponent() {
  const { getAccessToken, isLoading, signIn, user } = useAuth();
  const convexAuth = useConvexAuth();
  const provisionCurrentUser = useAction(
    api.users.provisionCurrentUserFromAuthIdentity,
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
    !isLoading &&
    user &&
    userId &&
    accessTokenReadyUserId === userId &&
    !convexAuth.isLoading &&
    !convexAuth.isAuthenticated
      ? CONVEX_AUTH_FAILED_MESSAGE
      : null;
  const activeCallbackTimeoutError =
    !isLoading &&
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
    if (isLoading || !userId || provisioningUserIdRef.current === userId) {
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
    isLoading,
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
      isLoading ||
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
    isLoading,
    user,
    userId,
  ]);

  useEffect(() => {
    if (
      isLoading ||
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
    provisionCurrentUser({
      workOSUserId: user.id,
    })
      .then(() => {
        logPreviewAuthCallback("provision:success");
        const returnTo = consumeAuthReturnToPath();
        navigateToReturnPath(navigate, returnTo);
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
  }, [
    activeAccessTokenError,
    activeCallbackTimeoutError,
    activeConvexAuthError,
    activeProvisioningError,
    accessTokenReadyUserId,
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    isLoading,
    navigate,
    provisionCurrentUser,
    user,
    userId,
  ]);

  // Auth completed but no user - keep retry path only.
  if (!isLoading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive font-medium">
            Anmeldung fehlgeschlagen
          </p>
          <p className="text-muted-foreground text-sm">
            Die Authentifizierung konnte nicht abgeschlossen werden.
          </p>
          <Button onClick={() => void signIn()}>Erneut anmelden</Button>
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

function getSameOriginReturnUrl(returnTo: string): null | URL {
  const returnUrl = new URL(returnTo, globalThis.location.origin);
  return returnUrl.origin === globalThis.location.origin ? returnUrl : null;
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
): void {
  const returnUrl = getSameOriginReturnUrl(returnTo);
  if (!returnUrl) {
    void navigate({ replace: true, to: BOOKING_PATH });
    return;
  }

  const fullPath = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
  switch (returnUrl.pathname) {
    case "/buchung": {
      void navigate({ replace: true, to: fullPath });
      return;
    }
    case "/praxisplaner": {
      void navigate({ replace: true, to: fullPath });
      return;
    }
    case "/regeln": {
      void navigate({ replace: true, to: fullPath });
      return;
    }
    default: {
      if (returnUrl.pathname.startsWith("/praxisplaner/")) {
        void navigate({ replace: true, to: fullPath });
        return;
      }
      void navigate({ replace: true, to: BOOKING_PATH });
    }
  }
}

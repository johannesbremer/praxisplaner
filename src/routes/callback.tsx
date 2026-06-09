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

function CallbackComponent() {
  const { getAccessToken, isLoading, signIn, user } = useAuth();
  const convexAuth = useConvexAuth();
  const provisionCurrentUser = useAction(
    api.users.provisionCurrentUserFromAuthIdentity,
  );
  const navigate = useNavigate();
  const accessTokenUserIdRef = useRef<null | string>(null);
  const provisioningUserIdRef = useRef<null | string>(null);
  const [accessTokenError, setAccessTokenError] = useState<null | {
    message: string;
    userId: string;
  }>(null);
  const [provisioningError, setProvisioningError] = useState<null | {
    message: string;
    userId: string;
  }>(null);
  const userId = user?.id ?? null;
  const activeAccessTokenError =
    accessTokenError?.userId === userId ? accessTokenError.message : null;
  const activeProvisioningError =
    provisioningError?.userId === userId ? provisioningError.message : null;

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
    getAccessToken()
      .then(() => {
        setAccessTokenError(null);
      })
      .catch((error: unknown) => {
        accessTokenUserIdRef.current = null;
        setAccessTokenError({
          message:
            error instanceof Error
              ? error.message
              : "Zugriffstoken konnte nicht abgerufen werden.",
          userId,
        });
      });
  }, [activeAccessTokenError, getAccessToken, isLoading, user, userId]);

  useEffect(() => {
    if (
      isLoading ||
      convexAuth.isLoading ||
      !convexAuth.isAuthenticated ||
      !user ||
      !userId ||
      accessTokenUserIdRef.current !== userId ||
      provisioningUserIdRef.current === userId ||
      activeAccessTokenError ||
      activeProvisioningError
    ) {
      return;
    }
    provisioningUserIdRef.current = userId;
    provisionCurrentUser({
      workOSUserId: user.id,
    })
      .then(() => {
        const returnTo = consumeAuthReturnToPath();
        if (returnTo === BOOKING_PATH) {
          void navigate({ replace: true, to: "/buchung" });
          return;
        }
        globalThis.location.replace(returnTo);
      })
      .catch((error: unknown) => {
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
    activeProvisioningError,
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

  const activeError = activeAccessTokenError ?? activeProvisioningError;

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
              setAccessTokenError(null);
              setProvisioningError(null);
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

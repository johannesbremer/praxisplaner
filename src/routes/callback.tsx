import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import type { FileRouteTypes } from "../routeTree.gen";

import { Button } from "../../components/ui/button";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/callback")({
  component: CallbackComponent,
});

const BOOKING_PATH = "/buchung" as const satisfies FileRouteTypes["to"];

function CallbackComponent() {
  const { isLoading, signIn, user } = useAuth();
  const convexAuth = useConvexAuth();
  const provisionCurrentUser = useMutation(
    api.users.provisionCurrentUserFromAuthIdentity,
  );
  const navigate = useNavigate();
  const provisioningUserIdRef = useRef<null | string>(null);
  const [provisioningError, setProvisioningError] = useState<null | {
    message: string;
    userId: string;
  }>(null);
  const userId = user?.id ?? null;
  const activeProvisioningError =
    provisioningError?.userId === userId ? provisioningError.message : null;

  useEffect(() => {
    if (
      isLoading ||
      convexAuth.isLoading ||
      !convexAuth.isAuthenticated ||
      !userId ||
      provisioningUserIdRef.current === userId ||
      activeProvisioningError
    ) {
      return;
    }
    provisioningUserIdRef.current = userId;
    provisionCurrentUser()
      .then(() => {
        void navigate({ replace: true, to: BOOKING_PATH });
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
    activeProvisioningError,
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    isLoading,
    navigate,
    provisionCurrentUser,
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

  if (activeProvisioningError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive font-medium">
            Anmeldung fehlgeschlagen
          </p>
          <p className="text-muted-foreground text-sm">
            {activeProvisioningError}
          </p>
          <Button
            onClick={() => {
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

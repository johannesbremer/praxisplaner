import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { useEffect } from "react";

import type { FileRouteTypes } from "../routeTree.gen";

import { Button } from "../../components/ui/button";

export const Route = createFileRoute("/callback")({
  component: CallbackComponent,
});

const BOOKING_PATH = "/buchung" as const satisfies FileRouteTypes["to"];

function CallbackComponent() {
  const { isLoading, signIn, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
      void navigate({ replace: true, to: BOOKING_PATH });
    }
  }, [isLoading, navigate, user]);

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

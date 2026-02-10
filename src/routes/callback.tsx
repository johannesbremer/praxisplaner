import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { useEffect } from "react";

import { Button } from "../../components/ui/button";

export const Route = createFileRoute("/callback")({
  component: CallbackComponent,
});

function CallbackComponent() {
  const { isLoading, signIn, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
      // Get the stored redirect URL or default to home
      const redirectUrl = localStorage.getItem("authRedirectUrl") || "/";
      localStorage.removeItem("authRedirectUrl");

      // Navigate to the original destination
      void navigate({ to: redirectUrl });
    }
  }, [isLoading, user, navigate]);

  // Auth completed but no user - show error state
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
          <div className="flex gap-2 justify-center">
            <Button
              onClick={() => void navigate({ to: "/" })}
              variant="outline"
            >
              Zur Startseite
            </Button>
            <Button onClick={() => void signIn()}>Erneut anmelden</Button>
          </div>
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

import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import {
  OrganizationSwitcher,
  UsersManagement,
  WorkOsWidgets,
} from "@workos-inc/widgets";
import { useAction } from "convex/react";
import { Building2, Loader2, UsersRound } from "lucide-react";
import { type BaseSyntheticEvent, useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { api } from "../../convex/_generated/api";
import { PatientAuthGate } from "../auth/access-control";

export const Route = createFileRoute("/account")({
  component: AccountRoute,
});

function AccountPage() {
  const {
    getAccessToken,
    isLoading,
    organizationId,
    permissions,
    switchToOrganization,
  } = useAuth();
  const createOrganizationPractice = useAction(
    api.workosOrganizations.createOrganizationPractice,
  );
  const syncCurrentOrganizationMembership = useAction(
    api.workosOrganizations.syncCurrentUserOrganizationMembership,
  );
  const [createError, setCreateError] = useState<null | string>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [practiceName, setPracticeName] = useState("");
  const canManageUsers = permissions.includes("widgets:users-table:manage");

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    void syncCurrentOrganizationMembership({ organizationId });
  }, [organizationId, syncCurrentOrganizationMembership]);

  const handleCreateOrganization = (event: BaseSyntheticEvent) => {
    event.preventDefault();
    const name = practiceName.trim();
    if (!name || isCreating) {
      return;
    }
    setCreateError(null);
    setIsCreating(true);
    createOrganizationPractice({ name })
      .then(({ organizationId: nextOrganizationId }) =>
        switchToOrganization({
          organizationId: nextOrganizationId,
          signInOpts: { state: { returnTo: "/account" } },
        }),
      )
      .then(() => {
        setPracticeName("");
      })
      .catch((error: unknown) => {
        setCreateError(
          error instanceof Error
            ? error.message
            : "Organisation konnte nicht erstellt werden.",
        );
      })
      .finally(() => {
        setIsCreating(false);
      });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Laden...</span>
        </div>
      </div>
    );
  }

  return (
    <WorkOsWidgets>
      <main className="min-h-screen bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Konto</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Organisation wechseln und Teamzugriff verwalten.
              </p>
            </div>
            <OrganizationSwitcher
              authToken={getAccessToken}
              organizationLabel="Praxen"
              switchToOrganization={switchToOrganization}
              variant="outline"
            />
          </header>

          <section className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
            <aside className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-3 rounded-md border bg-card p-4">
                <Building2 className="mt-0.5 h-4 w-4 text-foreground" />
                <div>
                  <div className="font-medium text-foreground">
                    Aktuelle Organisation
                  </div>
                  <div className="mt-1 break-all">
                    {organizationId ?? "Keine Organisation aktiv"}
                  </div>
                </div>
              </div>
              <form
                className="space-y-3 rounded-md border bg-card p-4"
                onSubmit={handleCreateOrganization}
              >
                <div className="font-medium text-foreground">
                  Neue Praxis anlegen
                </div>
                <Input
                  onChange={(event) => {
                    setPracticeName(event.target.value);
                  }}
                  placeholder="Praxisname"
                  value={practiceName}
                />
                {createError ? (
                  <p className="text-sm text-destructive">{createError}</p>
                ) : null}
                <Button
                  className="w-full"
                  disabled={isCreating || practiceName.trim().length === 0}
                  type="submit"
                >
                  {isCreating ? "Wird angelegt..." : "Praxis erstellen"}
                </Button>
              </form>
              <div className="flex items-start gap-3 rounded-md border bg-card p-4">
                <UsersRound className="mt-0.5 h-4 w-4 text-foreground" />
                <div>
                  <div className="font-medium text-foreground">
                    Benutzerverwaltung
                  </div>
                  <div className="mt-1">
                    {canManageUsers
                      ? "WorkOS steuert Einladungen, Rollen und Entzug von Zugriffen."
                      : "Der aktiven WorkOS-Rolle fehlt widgets:users-table:manage."}
                  </div>
                </div>
              </div>
            </aside>

            <div className="min-w-0 rounded-md border bg-card p-4">
              {canManageUsers ? (
                <UsersManagement authToken={getAccessToken} />
              ) : (
                <div className="text-sm text-muted-foreground">
                  Benutzerverwaltung ist erst verfügbar, wenn Ihre aktive
                  WorkOS-Rolle die Widget-Berechtigung enthält.
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </WorkOsWidgets>
  );
}

function AccountRoute() {
  return (
    <PatientAuthGate>
      <AccountPage />
    </PatientAuthGate>
  );
}

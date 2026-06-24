import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { UsersManagement, WorkOsWidgets } from "@workos-inc/widgets";
import { useAction, useQuery } from "convex/react";
import { Building2, Loader2, UsersRound } from "lucide-react";
import {
  type BaseSyntheticEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import type { Id } from "../../convex/_generated/dataModel";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { api } from "../../convex/_generated/api";
import { AccountAuthGate } from "../auth/access-control";
import { isAuthBypassEnabled } from "../auth/auth-bypass";

function getAuthReturnToPath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
}

export const Route = createFileRoute("/account")({
  component: AccountRoute,
});

interface WorkOSOrganizationOption {
  id: string;
  name: string;
  practiceId?: Id<"practices">;
}

function AccountPage() {
  const { isLoading, organizationId, switchToOrganization } = useAuth();
  const authBypassEnabled = isAuthBypassEnabled();
  const createOrganizationPractice = useAction(
    api.workosOrganizations.createOrganizationPractice,
  );
  const listCurrentUserOrganizations = useAction(
    api.workosOrganizations.listCurrentUserOrganizations,
  );
  const syncCurrentOrganizationMembership = useAction(
    api.workosOrganizations.syncCurrentUserOrganizationMembership,
  );
  const [createError, setCreateError] = useState<null | string>(null);
  const [createdOrganizationId, setCreatedOrganizationId] = useState<
    null | string
  >(null);
  const [isCreating, setIsCreating] = useState(false);
  const [organizationListError, setOrganizationListError] = useState<
    null | string
  >(null);
  const [organizations, setOrganizations] = useState<
    WorkOSOrganizationOption[]
  >([]);
  const [practiceName, setPracticeName] = useState("");

  const refreshOrganizations = useCallback(() => {
    listCurrentUserOrganizations({})
      .then((nextOrganizations) => {
        setOrganizationListError(null);
        setOrganizations(nextOrganizations);
      })
      .catch((error: unknown) => {
        setOrganizationListError(
          error instanceof Error
            ? error.message
            : "Organisationen konnten nicht geladen werden.",
        );
      });
  }, [listCurrentUserOrganizations]);

  useEffect(() => {
    refreshOrganizations();
  }, [refreshOrganizations]);

  useEffect(() => {
    if (organizations.length !== 1) {
      return;
    }
    const organization = organizations.at(0);
    if (!organization) {
      return;
    }
    void syncCurrentOrganizationMembership({ organizationId: organization.id });
    if (!authBypassEnabled && organization.id !== organizationId) {
      switchToOrganization({
        organizationId: organization.id,
        signInOpts: { state: { returnTo: getAuthReturnToPath() } },
      }).catch((error: unknown) => {
        setOrganizationListError(
          error instanceof Error
            ? error.message
            : "Organisation konnte nicht aktiviert werden.",
        );
      });
    }
  }, [
    organizationId,
    authBypassEnabled,
    organizations,
    switchToOrganization,
    syncCurrentOrganizationMembership,
  ]);

  const handleCreateOrganization = (event: BaseSyntheticEvent) => {
    event.preventDefault();
    const name = practiceName.trim();
    if (!name || isCreating) {
      return;
    }
    setCreateError(null);
    setCreatedOrganizationId(null);
    setIsCreating(true);
    createOrganizationPractice({ name })
      .then(({ organizationId: nextOrganizationId }) => {
        setCreatedOrganizationId(nextOrganizationId);
        setPracticeName("");
        refreshOrganizations();
        return authBypassEnabled
          ? undefined
          : switchToOrganization({
              organizationId: nextOrganizationId,
              signInOpts: { state: { returnTo: getAuthReturnToPath() } },
            });
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

  const organization = organizations.at(0) ?? null;
  const hasMultipleOrganizations = organizations.length > 1;

  return (
    <WorkOsWidgets>
      <main className="min-h-screen bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <header className="border-b pb-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Konto</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Praxis anlegen und Teamzugriff verwalten.
              </p>
            </div>
            {organizationListError ? (
              <p className="mt-2 text-sm text-destructive">
                {organizationListError}
              </p>
            ) : null}
          </header>

          {hasMultipleOrganizations ? (
            <div className="rounded-md border border-destructive/40 bg-card p-4 text-sm text-destructive">
              Ihr Konto ist mehreren WorkOS-Organisationen zugeordnet. Bitte
              entfernen Sie die zusaetzlichen Mitgliedschaften in WorkOS, damit
              genau eine Praxis aktiv ist.
            </div>
          ) : null}

          <section className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
            <aside className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-3 rounded-md border bg-card p-4">
                <Building2 className="mt-0.5 h-4 w-4 text-foreground" />
                <div>
                  <div className="font-medium text-foreground">Praxis</div>
                  <div className="mt-1 break-all">
                    {organization?.name ?? "Noch keine Praxis angelegt"}
                  </div>
                  {organization &&
                  !authBypassEnabled &&
                  organization.id !== organizationId ? (
                    <div className="mt-1 text-xs">
                      AuthKit-Sitzung wird auf diese Praxis aktualisiert.
                    </div>
                  ) : null}
                </div>
              </div>
              {organization ? null : (
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
                    placeholder="Eindeutiger Praxisname"
                    value={practiceName}
                  />
                  {createError ? (
                    <p className="text-sm text-destructive">{createError}</p>
                  ) : null}
                  {createdOrganizationId ? (
                    <p className="text-sm text-muted-foreground">
                      Praxis wurde angelegt.
                    </p>
                  ) : null}
                  <Button
                    className="w-full"
                    disabled={isCreating || practiceName.trim().length === 0}
                    type="submit"
                  >
                    {isCreating ? "Wird angelegt..." : "Praxis erstellen"}
                  </Button>
                </form>
              )}
              <div className="flex items-start gap-3 rounded-md border bg-card p-4">
                <UsersRound className="mt-0.5 h-4 w-4 text-foreground" />
                <div>
                  <div className="font-medium text-foreground">Team</div>
                  <div className="mt-1">
                    {organization && authBypassEnabled
                      ? "Lokale Entwicklungsdaten steuern Benutzer und Rollen."
                      : organization
                        ? "WorkOS steuert Einladungen, Rollen und Entzug von Zugriffen."
                        : "Legen Sie zuerst eine Praxis an."}
                  </div>
                </div>
              </div>
            </aside>

            <div className="min-w-0 space-y-4">
              <div className="rounded-md border bg-card p-4">
                {organization && authBypassEnabled ? (
                  <BypassOrganizationMembers
                    practiceId={organization.practiceId}
                  />
                ) : organization && !hasMultipleOrganizations ? (
                  <UsersManagementForOrganization
                    organizationId={organization.id}
                  />
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Legen Sie eine Praxis an, um Teammitglieder zu verwalten.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </WorkOsWidgets>
  );
}

function AccountRoute() {
  return (
    <AccountAuthGate>
      <AccountPage />
    </AccountAuthGate>
  );
}

function BypassOrganizationMembers({
  practiceId,
}: {
  practiceId: Id<"practices"> | undefined;
}) {
  const members = useQuery(
    api.practices.getOrganizationMembers,
    practiceId ? { practiceId } : "skip",
  );

  if (!practiceId) {
    return (
      <div className="text-sm text-muted-foreground">
        Keine lokale Praxis gefunden.
      </div>
    );
  }

  if (members === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Team wird geladen...</span>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Keine lokalen Teammitglieder gefunden.
      </div>
    );
  }

  return (
    <div className="divide-y rounded-md border">
      {members.map((member) => (
        <div
          className="flex items-center justify-between gap-4 p-3"
          key={member._id}
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {formatUsername(member.user)}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {member.user?.email ?? member.userId}
            </div>
          </div>
          <Badge className="shrink-0" variant="secondary">
            {formatOrganizationRole(member.role)}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function formatOrganizationRole(
  role: "admin" | "owner" | "patient" | "staff",
): string {
  switch (role) {
    case "admin": {
      return "Admin";
    }
    case "owner": {
      return "Owner";
    }
    case "patient": {
      return "Patient";
    }
    case "staff": {
      return "Staff";
    }
  }
}

function formatUsername(
  user: null | {
    email: string;
    firstName?: string;
    lastName?: string;
  },
): string {
  if (!user) {
    return "Unbekannter Benutzer";
  }
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return fullName || user.email;
}

function UsersManagementForOrganization({
  organizationId,
}: {
  organizationId: string;
}) {
  const getUsersManagementWidgetToken = useAction(
    api.workosOrganizations.getUsersManagementWidgetToken,
  );
  const getUsersManagementAuthToken = useCallback(async () => {
    return await getUsersManagementWidgetToken({ organizationId });
  }, [getUsersManagementWidgetToken, organizationId]);

  return <UsersManagement authToken={getUsersManagementAuthToken} />;
}

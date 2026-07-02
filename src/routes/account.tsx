import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { UsersManagement, WorkOsWidgets } from "@workos-inc/widgets";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Ban,
  Building2,
  Loader2,
  RotateCcw,
  UsersRound,
} from "lucide-react";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import { api } from "../../convex/_generated/api";
import { AccountAuthGate } from "../auth/access-control";
import { isAuthBypassEnabled } from "../auth/auth-bypass";
import { useRegisterGlobalUndoRedoControls } from "../hooks/use-global-undo-redo-controls";

function getAuthReturnToPath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
}

export const Route = createFileRoute("/account")({
  component: AccountRoute,
});

interface BlockHistoryCommand {
  block: OnlineAccountBlock;
  deletionSnapshotId?: Id<"onlineAccountBlockDeletionSnapshots">;
  kind: "unblock";
}

interface OnlineAccountBlock {
  _id: Id<"onlineAccountBlocks">;
  bookingIdentityId?: Id<"bookingIdentities">;
  createdAt: bigint;
  email: string;
  firstName?: string;
  lastName?: string;
  legacyUserId?: string;
  practiceId: Id<"practices">;
  reason: string;
  sourceSystem: "legacy-online" | "online";
  userId: Id<"users">;
}

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
  const [createWarning, setCreateWarning] = useState<null | string>(null);
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
  const [selectedTab, setSelectedTab] = useState("team");

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
    setCreateWarning(null);
    setCreatedOrganizationId(null);
    setIsCreating(true);
    createOrganizationPractice({ name })
      .then((result) => {
        if (result.status === "warning") {
          setCreateWarning(result.message);
          refreshOrganizations();
          return;
        }
        const nextOrganizationId = result.organizationId;
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
        setCreateWarning(null);
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
                  {createWarning ? (
                    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning-foreground">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <p>{createWarning}</p>
                    </div>
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

            <div className="min-w-0">
              <Tabs onValueChange={setSelectedTab} value={selectedTab}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="team">Team</TabsTrigger>
                  <TabsTrigger value="blocked">Gesperrte Konten</TabsTrigger>
                </TabsList>
                <TabsContent className="mt-4" value="team">
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
                        Legen Sie eine Praxis an, um Teammitglieder zu
                        verwalten.
                      </div>
                    )}
                  </div>
                </TabsContent>
                <TabsContent className="mt-4" value="blocked">
                  <BlockedAccountsTab
                    enabled={selectedTab === "blocked"}
                    practiceId={organization?.practiceId}
                  />
                </TabsContent>
              </Tabs>
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

function BlockedAccountsTab({
  enabled,
  practiceId,
}: {
  enabled: boolean;
  practiceId: Id<"practices"> | undefined;
}) {
  const blocks = useQuery(
    api.onlineAccountBlocks.listForPractice,
    practiceId ? { practiceId } : "skip",
  );
  const restoreDeletedSnapshot = useMutation(
    api.onlineAccountBlocks.restoreDeletedSnapshot,
  );
  const unblock = useMutation(api.onlineAccountBlocks.unblock);
  const [history, setHistory] = useState<{
    future: BlockHistoryCommand[];
    past: BlockHistoryCommand[];
  }>({ future: [], past: [] });
  const [pendingBlockId, setPendingBlockId] =
    useState<Id<"onlineAccountBlocks"> | null>(null);
  const [operationError, setOperationError] = useState<null | string>(null);

  const restoreBlock = useCallback(
    async (
      command: BlockHistoryCommand,
    ): Promise<null | OnlineAccountBlock> => {
      if (!practiceId) {
        setOperationError("Keine Praxis ausgewählt.");
        return null;
      }
      if (command.deletionSnapshotId === undefined) {
        setOperationError("Keine Wiederherstellung verfügbar.");
        return null;
      }
      const restoredId = await restoreDeletedSnapshot({
        deletionSnapshotId: command.deletionSnapshotId,
        practiceId,
      });
      return {
        ...command.block,
        _id: restoredId,
      };
    },
    [practiceId, restoreDeletedSnapshot],
  );

  const runUnblock = useCallback(
    async (block: OnlineAccountBlock): Promise<BlockHistoryCommand | null> => {
      if (!practiceId || pendingBlockId) {
        return null;
      }
      setPendingBlockId(block._id);
      setOperationError(null);
      try {
        const result = await unblock({ blockId: block._id, practiceId });
        return {
          block,
          deletionSnapshotId: result.deletionSnapshotId,
          kind: "unblock",
        };
      } catch (error) {
        setOperationError(
          error instanceof Error
            ? error.message
            : "Konto konnte nicht entsperrt werden.",
        );
        return null;
      } finally {
        setPendingBlockId(null);
      }
    },
    [pendingBlockId, practiceId, unblock],
  );

  const undo = useCallback(async () => {
    const command = history.past.at(-1);
    if (!command || pendingBlockId) {
      return;
    }
    setPendingBlockId(command.block._id);
    setOperationError(null);
    try {
      const restoredBlock = await restoreBlock(command);
      if (!restoredBlock) {
        return;
      }
      setHistory((current) => ({
        future: [{ ...command, block: restoredBlock }, ...current.future],
        past: current.past.slice(0, -1),
      }));
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "Sperre konnte nicht wiederhergestellt werden.",
      );
    } finally {
      setPendingBlockId(null);
    }
  }, [history.past, pendingBlockId, restoreBlock]);

  const redo = useCallback(async () => {
    const command = history.future.at(0);
    if (!command || pendingBlockId) {
      return;
    }
    const appliedCommand = await runUnblock(command.block);
    if (!appliedCommand) {
      return;
    }
    setHistory((current) => ({
      future: current.future.slice(1),
      past: [...current.past, appliedCommand],
    }));
  }, [history.future, pendingBlockId, runUnblock]);

  useRegisterGlobalUndoRedoControls(
    enabled
      ? {
          canRedo: history.future.length > 0 && pendingBlockId === null,
          canUndo: history.past.length > 0 && pendingBlockId === null,
          onRedo: redo,
          onUndo: undo,
        }
      : null,
  );

  if (!practiceId) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        Legen Sie zuerst eine Praxis an.
      </div>
    );
  }

  if (blocks === undefined) {
    return (
      <div className="rounded-md border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Gesperrte Konten werden geladen...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Gesperrte Online-Konten</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Diese Konten können keine Online-Termine buchen.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            disabled={history.past.length === 0 || pendingBlockId !== null}
            onClick={() => {
              void undo();
            }}
            size="icon"
            title="Entsperren rückgängig machen"
            type="button"
            variant="ghost"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            disabled={history.future.length === 0 || pendingBlockId !== null}
            onClick={() => {
              void redo();
            }}
            size="icon"
            title="Entsperren wiederholen"
            type="button"
            variant="ghost"
          >
            <RotateCcw className="h-4 w-4 scale-x-[-1]" />
          </Button>
        </div>
      </div>
      {operationError ? (
        <p className="mb-3 text-sm text-destructive">{operationError}</p>
      ) : null}
      {blocks.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <Ban className="h-4 w-4" />
          <span>Keine gesperrten Konten.</span>
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {blocks.map((block) => (
            <div
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between"
              key={block._id}
            >
              <div className="min-w-0 space-y-1">
                <div className="truncate text-sm font-medium">
                  {formatBlockedAccountName(block)}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {block.email}
                </div>
                <p className="text-sm">{block.reason}</p>
              </div>
              <Button
                disabled={pendingBlockId !== null}
                onClick={() => {
                  void runUnblock(block).then((command) => {
                    if (!command) {
                      return;
                    }
                    setHistory((current) => ({
                      future: [],
                      past: [...current.past, command],
                    }));
                  });
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {pendingBlockId === block._id
                  ? "Wird entsperrt..."
                  : "Entsperren"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
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

function formatBlockedAccountName(block: OnlineAccountBlock): string {
  return (
    [block.firstName, block.lastName].filter(Boolean).join(" ") || block.email
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

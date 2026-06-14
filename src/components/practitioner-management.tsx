// src/components/practitioner-management.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Trash2, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { asPractitionerId, asPractitionerLineageKey } from "@/convex/identity";
import { PRACTITIONER_MISSING_ENTITY_REGEX } from "@/lib/typed-regex";

import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";
import type { RuleSetCommand } from "../utils/rule-set-replay";

import {
  ruleSetIdFromReplayTarget,
  useRuleSetReplayTargetController,
} from "../utils/cow-history";
import { isMissingRuleSetEntityError } from "../utils/error-matching";
import { useErrorTracking } from "../utils/error-tracking";
import {
  findFrontendEntityByEntityId,
  findFrontendEntityByLineageKey,
  requireFrontendLineageEntities,
} from "../utils/frontend-lineage";
import { createPractitionerDependencyDeleteReplayAdapter } from "../utils/practitioner-dependency-delete-replay";
import {
  recordRuleSetCommand,
  registerRuleSetReplayAdapter,
} from "../utils/rule-set-command-executor";
import {
  createNamedLineageCreateReplayAdapter,
  createNamedLineageUpdateReplayAdapter,
} from "../utils/rule-set-named-lineage-replay";
import { createRuleSetCommandDescription } from "../utils/rule-set-replay";
import { encodeRuleSetSnapshot } from "../utils/rule-set-snapshot-codecs";

const isMissingEntityError = (error: unknown) =>
  isMissingRuleSetEntityError(error, PRACTITIONER_MISSING_ENTITY_REGEX);

interface PractitionerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: (action: RuleSetCommand) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  practitioner?: PractitionerWithLineage | undefined;
  ruleSetReplayTarget: RuleSetReplayTarget;
}

interface PractitionerManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRecordCommand?: (action: RuleSetCommand) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}

type PractitionersResult =
  (typeof api.entities.getPractitioners)["_returnType"];
type PractitionerWithLineage = FrontendLineageEntity<
  "practitioners",
  PractitionersResult[number]
>;

export default function PractitionerManagement({
  onDraftMutation,
  onRecordCommand,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
}: PractitionerManagementProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPractitioner, setEditingPractitioner] = useState<
    PractitionerWithLineage | undefined
  >();

  const { captureError } = useErrorTracking();

  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const practitioners: PractitionerWithLineage[] = useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      PractitionersResult[number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "PractitionerManagement",
    });
  }, [practitionersQuery]);
  const practitionersRef = useRef(practitioners);
  useEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const { getCowMutationArgs, handleDraftMutationResult } =
    useRuleSetReplayTargetController({
      ...(onDraftMutation && { onDraftMutation }),
      ...(onRuleSetCreated && { onRuleSetCreated }),
      ruleSetId,
      ruleSetReplayTarget,
    });
  const deleteWithDependenciesMutation = useMutation(
    api.entities.deletePractitionerWithDependencies,
  );
  const restoreWithDependenciesMutation = useMutation(
    api.entities.restorePractitionerWithDependencies,
  );
  const handleEdit = (practitioner: PractitionerWithLineage) => {
    setEditingPractitioner(practitioner);
    setIsDialogOpen(true);
  };

  const handleDelete = async (practitionerId: Id<"practitioners">) => {
    try {
      const practitioner = findFrontendEntityByEntityId(
        practitionersRef.current,
        asPractitionerId(practitionerId),
      );
      const deleteResult = await deleteWithDependenciesMutation({
        practiceId,
        practitionerId,
        ...getCowMutationArgs(),
        practitionerLineageKey:
          practitioner?.lineageKey ?? asPractitionerLineageKey(practitionerId),
      });
      handleDraftMutationResult(deleteResult);
      const currentSnapshot = deleteResult.snapshot;
      const currentPractitionerId = currentSnapshot.practitioner.id;
      const deletedPractitionerSnapshot = encodeRuleSetSnapshot(
        deleteResult.snapshot,
      );
      const command = createRuleSetCommandDescription({
        kind: "practitioner.deleteWithDependencies",
        label: "Arzt gelöscht",
        snapshots: {
          before: deletedPractitionerSnapshot,
        },
        target: {
          entityId: currentPractitionerId,
          lineageKey: currentSnapshot.practitioner.lineageKey,
        },
      });
      const replay = createPractitionerDependencyDeleteReplayAdapter<
        Id<"practitioners">,
        Id<"practitioners">,
        typeof currentSnapshot
      >({
        deleteWithDependencies: async (args) => {
          const result = await deleteWithDependenciesMutation({
            practiceId,
            practitionerId: args.practitionerId,
            practitionerLineageKey: args.practitionerLineageKey,
            ...getCowMutationArgs(),
          });
          handleDraftMutationResult(result);
          return { snapshot: result.snapshot };
        },
        findByLineage: (lineageKey) =>
          findFrontendEntityByLineageKey(
            practitionersRef.current,
            asPractitionerLineageKey(lineageKey),
          ),
        initialEntityId: currentPractitionerId,
        initialSnapshot: currentSnapshot,
        isMissingEntityError,
        restoreWithDependencies: async (snapshot) => {
          const result = await restoreWithDependenciesMutation({
            practiceId,
            snapshot,
            ...getCowMutationArgs(),
          });
          handleDraftMutationResult(result);
          return {
            restoredPractitionerId: result.restoredPractitionerId,
          };
        },
      });
      registerRuleSetReplayAdapter(command, replay);
      recordRuleSetCommand(onRecordCommand, command);
      toast.success("Arzt gelöscht");
    } catch (error: unknown) {
      captureError(error, {
        context: "practitioner_delete",
        practiceId,
        practitionerId,
      });

      toast.error("Fehler beim Löschen", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setEditingPractitioner(undefined);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Ärzte verwalten
            </CardTitle>
          </div>
          <Button
            onClick={() => {
              setIsDialogOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            <Plus className="h-4 w-4 mr-2" />
            Arzt hinzufügen
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {practitionersQuery ? (
          practitioners.length === 0 ? (
            <div className="text-center py-8">
              <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <div className="text-muted-foreground mb-4">
                Noch keine Ärzte angelegt.
              </div>
              <Button
                onClick={() => {
                  setIsDialogOpen(true);
                }}
                variant="outline"
              >
                <Plus className="h-4 w-4 mr-2" />
                Ersten Arzt hinzufügen
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {practitioners.map((practitioner) => (
                <div
                  className="p-4 border rounded-lg hover:bg-accent transition-colors"
                  key={practitioner._id}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{practitioner.name}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          handleEdit(practitioner);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => {
                          void handleDelete(practitioner._id);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Lade Ärzte...
          </div>
        )}
      </CardContent>

      <PractitionerDialog
        isOpen={isDialogOpen}
        onClose={handleDialogClose}
        practiceId={practiceId}
        practitioner={editingPractitioner}
        ruleSetReplayTarget={ruleSetReplayTarget}
        {...(onDraftMutation && { onDraftMutation })}
        {...(onRecordCommand && { onRecordCommand })}
        {...(onRuleSetCreated && { onRuleSetCreated })}
      />
    </Card>
  );
}

function PractitionerDialog({
  isOpen,
  onClose,
  onDraftMutation,
  onRecordCommand,
  onRuleSetCreated,
  practiceId,
  practitioner,
  ruleSetReplayTarget,
}: PractitionerDialogProps) {
  const { captureError } = useErrorTracking();
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);

  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const practitioners: PractitionerWithLineage[] = useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      PractitionersResult[number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "PractitionerDialog",
    });
  }, [practitionersQuery]);
  const practitionersRef = useRef(practitioners);
  useEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const { getCowMutationArgs, handleDraftMutationResult } =
    useRuleSetReplayTargetController({
      ...(onDraftMutation && { onDraftMutation }),
      ...(onRuleSetCreated && { onRuleSetCreated }),
      ruleSetId,
      ruleSetReplayTarget,
    });

  const createMutation = useMutation(api.entities.createPractitioner);
  const deleteMutation = useMutation(api.entities.deletePractitioner);
  const updateMutation = useMutation(api.entities.updatePractitioner);

  const form = useForm({
    defaultValues: {
      name: practitioner?.name ?? "",
    },
    onSubmit: async ({ value }) => {
      try {
        const trimmedName = value.name.trim();

        if (practitioner) {
          const beforeName = practitioner.name;
          const practitionerLineageKey = practitioner.lineageKey;
          // Update existing practitioner - extract ruleSetId
          const updateResult = await updateMutation({
            name: trimmedName,
            practiceId,
            practitionerId: practitioner._id,
            ...getCowMutationArgs(),
          });
          handleDraftMutationResult(updateResult);
          const command = createRuleSetCommandDescription({
            kind: "practitioner.update",
            label: "Arzt aktualisiert",
            payload: {
              after: { name: trimmedName },
              before: { name: beforeName },
              kind: "practitioner.update",
              lineageKey: practitionerLineageKey,
            },
            snapshots: {
              after: encodeRuleSetSnapshot({
                lineageKey: practitionerLineageKey,
                name: trimmedName,
              }),
              before: encodeRuleSetSnapshot({
                lineageKey: practitionerLineageKey,
                name: beforeName,
              }),
            },
            target: {
              entityId: updateResult.entityId,
              lineageKey: practitionerLineageKey,
            },
          });
          const replay = createNamedLineageUpdateReplayAdapter({
            command,
            entitiesRef: practitionersRef,
            initialEntityId: asPractitionerId(updateResult.entityId),
            lineageKey: practitionerLineageKey,
            payload: {
              after: { name: trimmedName },
              before: { name: beforeName },
              kind: "practitioner.update",
              lineageKey: practitionerLineageKey,
            },
            redoMissingMessage:
              "Der Arzt wurde bereits gelöscht und kann nicht erneut aktualisiert werden.",
            runRedo: async (currentPractitionerId) => {
              const redoResult = await updateMutation({
                name: trimmedName,
                practiceId,
                practitionerId: currentPractitionerId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(redoResult);
              return { entityId: asPractitionerId(redoResult.entityId) };
            },
            runUndo: async (currentPractitionerId) => {
              const undoResult = await updateMutation({
                name: beforeName,
                practiceId,
                practitionerId: currentPractitionerId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: asPractitionerId(undoResult.entityId) };
            },
            undoMissingMessage:
              "Der Arzt wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
          });
          registerRuleSetReplayAdapter(command, replay);
          recordRuleSetCommand(onRecordCommand, command);

          toast.success("Arzt aktualisiert");
        } else {
          // Create new practitioner - extract both entityId and ruleSetId
          const createResult = await createMutation({
            name: trimmedName,
            practiceId,
            ...getCowMutationArgs(),
          });
          handleDraftMutationResult(createResult);
          const entityId = asPractitionerId(createResult.entityId);
          const practitionerLineageKey = asPractitionerLineageKey(
            createResult.entityId,
          );
          const command = createRuleSetCommandDescription({
            kind: "practitioner.create",
            label: "Arzt erstellt",
            payload: {
              kind: "practitioner.create",
              lineageKey: practitionerLineageKey,
              name: trimmedName,
            },
            snapshots: {
              after: encodeRuleSetSnapshot({
                lineageKey: practitionerLineageKey,
                name: trimmedName,
              }),
            },
            target: {
              entityId,
              lineageKey: practitionerLineageKey,
            },
          });
          const replay = createNamedLineageCreateReplayAdapter({
            command,
            entitiesRef: practitionersRef,
            initialEntityId: entityId,
            isMissingEntityError,
            lineageKey: practitionerLineageKey,
            payload: {
              kind: "practitioner.create",
              lineageKey: practitionerLineageKey,
              name: trimmedName,
            },
            runCreate: async () => {
              const recreateResult = await createMutation({
                lineageKey: practitionerLineageKey,
                name: trimmedName,
                practiceId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(recreateResult);
              return { entityId: asPractitionerId(recreateResult.entityId) };
            },
            runDelete: async (currentPractitionerId) => {
              const undoResult = await deleteMutation({
                practiceId,
                practitionerId: currentPractitionerId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: asPractitionerId(undoResult.entityId) };
            },
          });
          registerRuleSetReplayAdapter(command, replay);
          recordRuleSetCommand(onRecordCommand, command);
          toast.success("Arzt erstellt");
        }

        onClose();
        form.reset();
      } catch (error: unknown) {
        captureError(error, {
          context: "practitioner_save",
          formData: value,
          isUpdate: !!practitioner,
          practiceId,
          practitionerId: practitioner?._id,
        });

        toast.error("Fehler beim Speichern", {
          description:
            error instanceof Error ? error.message : "Unbekannter Fehler",
        });
      }
    },
  });

  return (
    <Dialog onOpenChange={onClose} open={isOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {practitioner ? "Arzt bearbeiten" : "Neuen Arzt hinzufügen"}
          </DialogTitle>
          <DialogDescription>
            {practitioner
              ? "Bearbeiten Sie die Daten des Arztes."
              : "Fügen Sie einen neuen Arzt zu Ihrer Praxis hinzu."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) =>
                value.trim() ? undefined : "Name ist erforderlich",
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                  }}
                  placeholder="Dr. Max Mustermann"
                  required
                  value={field.state.value}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <div className="flex justify-end space-x-2 pt-4">
            <Button onClick={onClose} type="button" variant="outline">
              Abbrechen
            </Button>
            <Button type="submit">
              {practitioner ? "Speichern" : "Erstellen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

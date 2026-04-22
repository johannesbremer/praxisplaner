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

import type { LocalHistoryAction } from "../hooks/use-local-history";
import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";

import {
  ruleSetIdFromReplayTarget,
  toCowMutationArgs,
  updateRuleSetReplayTarget,
} from "../utils/cow-history";
import {
  registerLineageCreateHistoryAction,
  registerLineageUpdateHistoryAction,
} from "../utils/cow-history-actions";
import { isMissingRuleSetEntityError } from "../utils/error-matching";
import { useErrorTracking } from "../utils/error-tracking";
import {
  findFrontendEntityByEntityId,
  findFrontendEntityByLineageKey,
  mapFrontendLineageEntities,
} from "../utils/frontend-lineage";

const isMissingEntityError = (error: unknown) =>
  isMissingRuleSetEntityError(error, PRACTITIONER_MISSING_ENTITY_REGEX);

interface PractitionerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  practitioner?: PractitionerWithLineage | undefined;
  ruleSetReplayTarget: RuleSetReplayTarget;
}

interface PractitionerManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
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
  onRegisterHistoryAction,
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
<<<<<<< ours
  const practitioners: PractitionerWithLineage[] = useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return mapFrontendLineageEntities<
      "practitioners",
      PractitionersResult[number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "PractitionerManagement",
    }).match(
      (value) => value,
      () => [],
    );
  }, [practitionersQuery]);
||||||| base
  const practitioners: PractitionerWithLineage[] = useMemo(
    () =>
      practitionersQuery
        ? mapFrontendLineageEntities<
            "practitioners",
            PractitionersResult[number]
          >({
            entities: practitionersQuery,
            entityType: "practitioner",
            source: "PractitionerManagement",
          })
        : [],
    [practitionersQuery],
  );
=======
  const practitioners: PractitionerWithLineage[] = useMemo(
    () =>
      practitionersQuery
        ? mapFrontendLineageEntities<
            "practitioners",
            PractitionersResult[number]
          >(practitionersQuery)
        : [],
    [practitionersQuery],
  );
>>>>>>> theirs
  const practitionersRef = useRef(practitioners);
  useEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const ruleSetReplayTargetRef = useRef(ruleSetReplayTarget);
  useEffect(() => {
    ruleSetReplayTargetRef.current = ruleSetReplayTarget;
  }, [ruleSetReplayTarget]);
  const getCowMutationArgs = () =>
    toCowMutationArgs(ruleSetReplayTargetRef.current);
  const deleteWithDependenciesMutation = useMutation(
    api.entities.deletePractitionerWithDependencies,
  );
  const restoreWithDependenciesMutation = useMutation(
    api.entities.restorePractitionerWithDependencies,
  );
  const handleDraftMutationResult = (result: DraftMutationResult) => {
    ruleSetReplayTargetRef.current = updateRuleSetReplayTarget(
      ruleSetReplayTargetRef.current,
      result,
    );
    onDraftMutation?.(result);
    if (onRuleSetCreated && result.ruleSetId !== ruleSetId) {
      onRuleSetCreated(result.ruleSetId);
    }
  };

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
      let currentSnapshot = deleteResult.snapshot;
      let currentPractitionerId = currentSnapshot.practitioner.id;
      onRegisterHistoryAction?.({
        label: "Arzt gelöscht",
        redo: async () => {
          const existingByLineage = findFrontendEntityByLineageKey(
            practitionersRef.current,
            asPractitionerLineageKey(currentSnapshot.practitioner.lineageKey),
          );
          if (!existingByLineage) {
            return { status: "applied" as const };
          }
          currentPractitionerId = existingByLineage._id;

          try {
            const redoResult = await deleteWithDependenciesMutation({
              practiceId,
              practitionerId: currentPractitionerId,
              practitionerLineageKey: currentSnapshot.practitioner.lineageKey,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(redoResult);
            currentSnapshot = redoResult.snapshot;
            currentPractitionerId = currentSnapshot.practitioner.id;
            return { status: "applied" as const };
          } catch (error: unknown) {
            if (isMissingEntityError(error)) {
              const currentByLineage = findFrontendEntityByLineageKey(
                practitionersRef.current,
                asPractitionerLineageKey(
                  currentSnapshot.practitioner.lineageKey,
                ),
              );
              if (!currentByLineage) {
                return { status: "applied" as const };
              }
              try {
                const redoResult = await deleteWithDependenciesMutation({
                  practiceId,
                  practitionerId: currentByLineage._id,
                  practitionerLineageKey:
                    currentSnapshot.practitioner.lineageKey,
                  ...getCowMutationArgs(),
                });
                handleDraftMutationResult(redoResult);
                currentSnapshot = redoResult.snapshot;
                currentPractitionerId = currentSnapshot.practitioner.id;
                return { status: "applied" as const };
              } catch (retryError: unknown) {
                if (isMissingEntityError(retryError)) {
                  return { status: "applied" as const };
                }
                return {
                  message:
                    retryError instanceof Error
                      ? retryError.message
                      : "Der Arzt konnte nicht gelöscht werden.",
                  status: "conflict" as const,
                };
              }
            }
            return {
              message:
                error instanceof Error
                  ? error.message
                  : "Der Arzt konnte nicht gelöscht werden.",
              status: "conflict" as const,
            };
          }
        },
        undo: async () => {
          try {
            const restoreResult = await restoreWithDependenciesMutation({
              practiceId,
              snapshot: currentSnapshot,
              ...getCowMutationArgs(),
            });
            handleDraftMutationResult(restoreResult);
            currentPractitionerId = restoreResult.restoredPractitionerId;

            return { status: "applied" as const };
          } catch (error: unknown) {
            return {
              message:
                error instanceof Error
                  ? error.message
                  : "Der Arzt konnte nicht wiederhergestellt werden.",
              status: "conflict" as const,
            };
          }
        },
      });
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
        {...(onRegisterHistoryAction && { onRegisterHistoryAction })}
        {...(onRuleSetCreated && { onRuleSetCreated })}
      />
    </Card>
  );
}

function PractitionerDialog({
  isOpen,
  onClose,
  onDraftMutation,
  onRegisterHistoryAction,
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
<<<<<<< ours
  const practitioners: PractitionerWithLineage[] = useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return mapFrontendLineageEntities<
      "practitioners",
      PractitionersResult[number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "PractitionerDialog",
    }).match(
      (value) => value,
      () => [],
    );
  }, [practitionersQuery]);
||||||| base
  const practitioners: PractitionerWithLineage[] = useMemo(
    () =>
      practitionersQuery
        ? mapFrontendLineageEntities<
            "practitioners",
            PractitionersResult[number]
          >({
            entities: practitionersQuery,
            entityType: "practitioner",
            source: "PractitionerDialog",
          })
        : [],
    [practitionersQuery],
  );
=======
  const practitioners: PractitionerWithLineage[] = useMemo(
    () =>
      practitionersQuery
        ? mapFrontendLineageEntities<
            "practitioners",
            PractitionersResult[number]
          >(practitionersQuery)
        : [],
    [practitionersQuery],
  );
>>>>>>> theirs
  const practitionersRef = useRef(practitioners);
  useEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const ruleSetReplayTargetRef = useRef(ruleSetReplayTarget);
  useEffect(() => {
    ruleSetReplayTargetRef.current = ruleSetReplayTarget;
  }, [ruleSetReplayTarget]);
  const getCowMutationArgs = () =>
    toCowMutationArgs(ruleSetReplayTargetRef.current);

  const createMutation = useMutation(api.entities.createPractitioner);
  const deleteMutation = useMutation(api.entities.deletePractitioner);
  const updateMutation = useMutation(api.entities.updatePractitioner);
  const handleDraftMutationResult = (result: DraftMutationResult) => {
    ruleSetReplayTargetRef.current = updateRuleSetReplayTarget(
      ruleSetReplayTargetRef.current,
      result,
    );
    onDraftMutation?.(result);
    if (onRuleSetCreated && result.ruleSetId !== ruleSetId) {
      onRuleSetCreated(result.ruleSetId);
    }
  };

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
          registerLineageUpdateHistoryAction({
            entitiesRef: practitionersRef,
            initialEntityId: asPractitionerId(updateResult.entityId),
            label: "Arzt aktualisiert",
            lineageKey: practitionerLineageKey,
            onRegisterHistoryAction,
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
            validateRedo: (current) => {
              if (current.name !== beforeName) {
                return "Der Arzt wurde zwischenzeitlich geändert und kann nicht erneut aktualisiert werden.";
              }
              return null;
            },
            validateUndo: (current) => {
              if (current.name !== trimmedName) {
                return "Der Arzt wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.";
              }
              return null;
            },
          });

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
          registerLineageCreateHistoryAction({
            entitiesRef: practitionersRef,
            initialEntityId: entityId,
            isMissingEntityError,
            label: "Arzt erstellt",
            lineageKey: practitionerLineageKey,
            onRegisterHistoryAction,
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
            validateBeforeCreate: () => {
              const duplicate = practitionersRef.current.find(
                (entry) => entry.name === trimmedName,
              );
              if (duplicate) {
                return "Der Arzt existiert bereits und kann nicht erneut erstellt werden.";
              }
              return null;
            },
          });
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
                  <p className="text-sm text-red-500">
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

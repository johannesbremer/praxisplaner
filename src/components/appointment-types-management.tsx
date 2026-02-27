import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Package2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as z from "zod";

import type { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";

import type { LocalHistoryAction } from "../hooks/use-local-history";

type AppointmentType = AppointmentTypesResult[number];

interface AppointmentTypesManagementProps {
  expectedDraftRevision: null | number;
  onDraftMutation?: (result: {
    draftRevision: number;
    ruleSetId: Id<"ruleSets">;
  }) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

type AppointmentTypesResult =
  (typeof api.entities.getAppointmentTypes)["_returnType"];
type PractitionersResult =
  (typeof api.entities.getPractitioners)["_returnType"];
type PractitionerWithLineage = PractitionersResult[number];

// Form schema using Zod
const formSchema = z.object({
  duration: z
    .number()
    .min(5, "Dauer muss mindestens 5 Minuten betragen")
    .max(480, "Dauer darf maximal 480 Minuten (8 Stunden) betragen")
    .refine((val) => val % 5 === 0, {
      message: "Dauer muss in 5-Minuten-Schritten angegeben werden",
    }),
  name: z
    .string()
    .min(2, "Name muss mindestens 2 Zeichen lang sein")
    .max(50, "Name darf maximal 50 Zeichen lang sein"),
  practitionerIds: z
    .array(z.string())
    .min(1, "Mindestens ein Behandler muss ausgewählt werden"),
});

interface PractitionerHistorySnapshot {
  lineageId: Id<"practitioners">;
  name: string;
}

const toSnapshotLineageIds = (snapshots: PractitionerHistorySnapshot[]) =>
  snapshots.map((snapshot) => snapshot.lineageId).toSorted();

const samePractitionerLineageIds = (
  left: Id<"practitioners">[],
  right: Id<"practitioners">[],
) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
};

const isMissingEntityError = (error: unknown) =>
  error instanceof Error &&
  !/source rule set not found/i.test(error.message) &&
  /already deleted|bereits gelöscht|appointment type not found|terminart.*nicht gefunden/i.test(
    error.message,
  );

export function AppointmentTypesManagement({
  expectedDraftRevision,
  onDraftMutation,
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  ruleSetId,
}: AppointmentTypesManagementProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAppointmentType, setEditingAppointmentType] =
    useState<AppointmentType | null>(null);

  const appointmentTypesQuery = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });
  const practitionersQuery = useQuery(api.entities.getPractitioners, {
    ruleSetId,
  });
  const createAppointmentTypeMutation = useMutation(
    api.entities.createAppointmentType,
  );
  const updateAppointmentTypeMutation = useMutation(
    api.entities.updateAppointmentType,
  );
  const deleteAppointmentTypeMutation = useMutation(
    api.entities.deleteAppointmentType,
  );

  const appointmentTypes: AppointmentType[] = useMemo(
    () => appointmentTypesQuery ?? [],
    [appointmentTypesQuery],
  );
  const practitioners = useMemo(
    () => practitionersQuery ?? [],
    [practitionersQuery],
  );
  const appointmentTypesRef = useRef<AppointmentType[]>(appointmentTypes);
  useEffect(() => {
    appointmentTypesRef.current = appointmentTypes;
  }, [appointmentTypes]);
  const practitionersRef = useRef<PractitionerWithLineage[]>(practitioners);
  useEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const expectedDraftRevisionRef = useRef<null | number>(expectedDraftRevision);
  useEffect(() => {
    expectedDraftRevisionRef.current = expectedDraftRevision;
  }, [expectedDraftRevision]);

  const getExpectedDraftRevision = () => expectedDraftRevisionRef.current;

  const handleDraftMutationResult = (result: {
    draftRevision: number;
    ruleSetId: Id<"ruleSets">;
  }) => {
    expectedDraftRevisionRef.current = result.draftRevision;
    onDraftMutation?.(result);
    if (onRuleSetCreated && result.ruleSetId !== ruleSetId) {
      onRuleSetCreated(result.ruleSetId);
    }
  };

  const resolvePractitionerLineageKey = (practitionerId: Id<"practitioners">) =>
    practitionersRef.current.find(
      (practitioner) => practitioner._id === practitionerId,
    )?.lineageKey ?? practitionerId;

  const createPractitionerSnapshots = (
    practitionerIds: Id<"practitioners">[],
  ): PractitionerHistorySnapshot[] => {
    const nameById = new Map(
      practitionersRef.current.map((practitioner) => [
        practitioner._id,
        practitioner.name,
      ]),
    );

    return practitionerIds.map((id) => ({
      lineageId: resolvePractitionerLineageKey(id),
      name: nameById.get(id) ?? id,
    }));
  };

  const practitionerLineageIdsForCurrentIds = (
    practitionerIds: Id<"practitioners">[],
  ) =>
    practitionerIds
      .map((practitionerId) => resolvePractitionerLineageKey(practitionerId))
      .toSorted();

  const resolvePractitionerIdsFromSnapshots = (
    snapshots: PractitionerHistorySnapshot[],
  ):
    | { ids: Id<"practitioners">[] }
    | { message: string; status: "conflict" } => {
    const resolvedIds: Id<"practitioners">[] = [];
    const seen = new Set<Id<"practitioners">>();

    for (const snapshot of snapshots) {
      const lineageMatches = practitionersRef.current.filter(
        (practitioner) => practitioner.lineageKey === snapshot.lineageId,
      );

      if (lineageMatches.length > 1) {
        return {
          message:
            `[HISTORY:PRACTITIONER_LINEAGE_AMBIGUOUS] Der Behandler "${snapshot.name}" kann nicht eindeutig zugeordnet werden.\n` +
            `Lineage-ID: ${snapshot.lineageId}\n` +
            `Regelset: ${ruleSetId}\n` +
            `Treffer: ${lineageMatches.length}`,
          status: "conflict",
        };
      }

      const resolvedPractitionerId = lineageMatches[0]?._id;
      if (!resolvedPractitionerId) {
        return {
          message:
            `[HISTORY:PRACTITIONER_LINEAGE_MISSING] Der Behandler "${snapshot.name}" konnte im aktuellen Regelset nicht aufgelöst werden.\n` +
            `Lineage-ID: ${snapshot.lineageId}\n` +
            `Regelset: ${ruleSetId}\n` +
            `Hinweis: Die Undo/Redo-Aktion verweist auf eine Behandler-Linie, die im aktuellen Entwurf fehlt.`,
          status: "conflict",
        };
      }

      if (!seen.has(resolvedPractitionerId)) {
        seen.add(resolvedPractitionerId);
        resolvedIds.push(resolvedPractitionerId);
      }
    }

    if (resolvedIds.length === 0) {
      return {
        message: "Mindestens ein Behandler muss ausgewählt werden.",
        status: "conflict",
      };
    }

    return { ids: resolvedIds };
  };

  const form = useForm({
    defaultValues: {
      duration: 30,
      name: "",
      practitionerIds: [] as string[],
    },
    onSubmit: async ({ value }) => {
      try {
        const trimmedName = value.name.trim();
        const formPractitionerIds =
          value.practitionerIds as Id<"practitioners">[];
        const formPractitionerSnapshots =
          createPractitionerSnapshots(formPractitionerIds);
        const resolvedFormPractitionerIds = resolvePractitionerIdsFromSnapshots(
          formPractitionerSnapshots,
        );

        if ("status" in resolvedFormPractitionerIds) {
          toast.error("Fehler beim Speichern", {
            description: resolvedFormPractitionerIds.message,
          });
          return;
        }

        if (editingAppointmentType) {
          const beforeState = {
            duration: editingAppointmentType.duration,
            name: editingAppointmentType.name,
            practitionerIds: editingAppointmentType.allowedPractitionerIds,
          };
          const afterState = {
            duration: value.duration,
            name: trimmedName,
            practitionerIds: resolvedFormPractitionerIds.ids,
          };
          const beforePractitionerSnapshots = createPractitionerSnapshots(
            beforeState.practitionerIds,
          );
          const afterPractitionerSnapshots = createPractitionerSnapshots(
            afterState.practitionerIds,
          );

          // Update existing appointment type
          const updateResult = await updateAppointmentTypeMutation({
            appointmentTypeId: editingAppointmentType._id,
            duration: value.duration,
            expectedDraftRevision: getExpectedDraftRevision(),
            name: trimmedName,
            practiceId,
            practitionerIds: afterState.practitionerIds,
            selectedRuleSetId: ruleSetId,
          });
          handleDraftMutationResult(updateResult);

          onRegisterHistoryAction?.({
            label: "Terminart aktualisiert",
            redo: async () => {
              const current = appointmentTypesRef.current.find(
                (type) => type._id === editingAppointmentType._id,
              );

              if (
                current?.name !== beforeState.name ||
                current.duration !== beforeState.duration ||
                !samePractitionerLineageIds(
                  practitionerLineageIdsForCurrentIds(
                    current.allowedPractitionerIds,
                  ),
                  toSnapshotLineageIds(beforePractitionerSnapshots),
                )
              ) {
                return {
                  message:
                    "Die Terminart wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.",
                  status: "conflict" as const,
                };
              }

              const resolvedRedoPractitionerIds =
                resolvePractitionerIdsFromSnapshots(afterPractitionerSnapshots);
              if ("status" in resolvedRedoPractitionerIds) {
                return resolvedRedoPractitionerIds;
              }

              const redoResult = await updateAppointmentTypeMutation({
                appointmentTypeId: editingAppointmentType._id,
                duration: afterState.duration,
                expectedDraftRevision: getExpectedDraftRevision(),
                name: afterState.name,
                practiceId,
                practitionerIds: resolvedRedoPractitionerIds.ids,
                selectedRuleSetId: ruleSetId,
              });
              handleDraftMutationResult(redoResult);

              return { status: "applied" as const };
            },
            undo: async () => {
              const current = appointmentTypesRef.current.find(
                (type) => type._id === editingAppointmentType._id,
              );

              if (
                current?.name !== afterState.name ||
                current.duration !== afterState.duration ||
                !samePractitionerLineageIds(
                  practitionerLineageIdsForCurrentIds(
                    current.allowedPractitionerIds,
                  ),
                  toSnapshotLineageIds(afterPractitionerSnapshots),
                )
              ) {
                return {
                  message:
                    "Die Terminart wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.",
                  status: "conflict" as const,
                };
              }

              const resolvedUndoPractitionerIds =
                resolvePractitionerIdsFromSnapshots(
                  beforePractitionerSnapshots,
                );
              if ("status" in resolvedUndoPractitionerIds) {
                return resolvedUndoPractitionerIds;
              }

              const undoResult = await updateAppointmentTypeMutation({
                appointmentTypeId: editingAppointmentType._id,
                duration: beforeState.duration,
                expectedDraftRevision: getExpectedDraftRevision(),
                name: beforeState.name,
                practiceId,
                practitionerIds: resolvedUndoPractitionerIds.ids,
                selectedRuleSetId: ruleSetId,
              });
              handleDraftMutationResult(undoResult);

              return { status: "applied" as const };
            },
          });

          toast.success("Terminart aktualisiert", {
            description: `Terminart "${value.name}" wurde erfolgreich aktualisiert.`,
          });

          setIsDialogOpen(false);
          setEditingAppointmentType(null);
          form.reset();
        } else {
          // Create new appointment type
          const createResult = await createAppointmentTypeMutation({
            duration: value.duration,
            expectedDraftRevision: getExpectedDraftRevision(),
            name: trimmedName,
            practiceId,
            practitionerIds: resolvedFormPractitionerIds.ids,
            selectedRuleSetId: ruleSetId,
          });
          handleDraftMutationResult(createResult);
          const { entityId } = createResult;

          let currentAppointmentTypeId = entityId;
          const appointmentTypeLineageKey = entityId;

          onRegisterHistoryAction?.({
            label: "Terminart erstellt",
            redo: async () => {
              const existingByLineage = appointmentTypesRef.current.find(
                (type) => type.lineageKey === appointmentTypeLineageKey,
              );
              if (existingByLineage) {
                currentAppointmentTypeId = existingByLineage._id;
                return { status: "applied" as const };
              }

              const existingByName = appointmentTypesRef.current.find(
                (type) => type.name === trimmedName,
              );
              if (existingByName) {
                return {
                  message: `[HISTORY:APPOINTMENT_TYPE_NAME_CONFLICT] Die Terminart kann nicht wiederhergestellt werden, weil bereits eine andere Terminart mit dem Namen "${trimmedName}" existiert.`,
                  status: "conflict" as const,
                };
              }

              const recreateResult = await createAppointmentTypeMutation({
                duration: value.duration,
                expectedDraftRevision: getExpectedDraftRevision(),
                lineageKey: appointmentTypeLineageKey,
                name: trimmedName,
                practiceId,
                practitionerIds: resolvedFormPractitionerIds.ids,
                selectedRuleSetId: ruleSetId,
              });
              handleDraftMutationResult(recreateResult);
              currentAppointmentTypeId = recreateResult.entityId;
              return { status: "applied" as const };
            },
            undo: async () => {
              try {
                const undoResult = await deleteAppointmentTypeMutation({
                  appointmentTypeId: currentAppointmentTypeId,
                  appointmentTypeLineageKey,
                  expectedDraftRevision: getExpectedDraftRevision(),
                  practiceId,
                  selectedRuleSetId: ruleSetId,
                });
                handleDraftMutationResult(undoResult);
                return { status: "applied" as const };
              } catch (error: unknown) {
                if (isMissingEntityError(error)) {
                  return { status: "applied" as const };
                }
                return {
                  message:
                    error instanceof Error
                      ? error.message
                      : "Die Terminart konnte nicht gelöscht werden.",
                  status: "conflict" as const,
                };
              }
            },
          });

          toast.success("Terminart erstellt", {
            description: `Terminart "${value.name}" wurde erfolgreich erstellt.`,
          });

          setIsDialogOpen(false);
          form.reset();
        }
      } catch (error: unknown) {
        toast.error(
          editingAppointmentType
            ? "Fehler beim Aktualisieren"
            : "Fehler beim Erstellen",
          {
            description:
              error instanceof Error ? error.message : "Unbekannter Fehler",
          },
        );
      }
    },
    validators: {
      onSubmit: formSchema,
    },
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingAppointmentType(null);
    form.reset();
  };

  const openCreateDialog = () => {
    setEditingAppointmentType(null);
    form.reset();
    setIsDialogOpen(true);
  };

  const openEditDialog = (appointmentType: AppointmentType) => {
    const availablePractitionerIds = new Set(
      practitioners.map((practitioner) => practitioner._id),
    );
    const validPractitionerIds = appointmentType.allowedPractitionerIds.filter(
      (practitionerId) => availablePractitionerIds.has(practitionerId),
    );

    setEditingAppointmentType(appointmentType);
    form.setFieldValue("name", appointmentType.name);
    form.setFieldValue("duration", appointmentType.duration);
    form.setFieldValue("practitionerIds", validPractitionerIds);

    if (
      validPractitionerIds.length !==
      appointmentType.allowedPractitionerIds.length
    ) {
      toast.info(
        "Mindestens ein zuvor zugeordneter Behandler existiert nicht mehr und wurde entfernt.",
      );
    }

    setIsDialogOpen(true);
  };

  const handleDelete = async (appointmentType: AppointmentType) => {
    try {
      const deletedSnapshot = {
        duration: appointmentType.duration,
        lineageKey: appointmentType.lineageKey,
        name: appointmentType.name,
        practitionerIds: appointmentType.allowedPractitionerIds,
      };
      const deletedPractitionerSnapshots = createPractitionerSnapshots(
        deletedSnapshot.practitionerIds,
      );

      const deleteResult = await deleteAppointmentTypeMutation({
        appointmentTypeId: appointmentType._id,
        appointmentTypeLineageKey: deletedSnapshot.lineageKey,
        expectedDraftRevision: getExpectedDraftRevision(),
        practiceId,
        selectedRuleSetId: ruleSetId,
      });
      handleDraftMutationResult(deleteResult);

      let currentAppointmentTypeId = appointmentType._id;

      onRegisterHistoryAction?.({
        label: "Terminart gelöscht",
        redo: async () => {
          try {
            const redoResult = await deleteAppointmentTypeMutation({
              appointmentTypeId: currentAppointmentTypeId,
              appointmentTypeLineageKey: deletedSnapshot.lineageKey,
              expectedDraftRevision: getExpectedDraftRevision(),
              practiceId,
              selectedRuleSetId: ruleSetId,
            });
            handleDraftMutationResult(redoResult);
            return { status: "applied" as const };
          } catch (error: unknown) {
            if (isMissingEntityError(error)) {
              return { status: "applied" as const };
            }
            return {
              message:
                error instanceof Error
                  ? error.message
                  : "Die Terminart konnte nicht gelöscht werden.",
              status: "conflict" as const,
            };
          }
        },
        undo: async () => {
          const existingByLineage = appointmentTypesRef.current.find(
            (type) => type.lineageKey === deletedSnapshot.lineageKey,
          );
          if (existingByLineage) {
            const existingPractitionerLineageIds =
              practitionerLineageIdsForCurrentIds(
                existingByLineage.allowedPractitionerIds,
              );
            const deletedPractitionerLineageIds = toSnapshotLineageIds(
              deletedPractitionerSnapshots,
            );
            const isSameDefinition =
              existingByLineage.duration === deletedSnapshot.duration &&
              samePractitionerLineageIds(
                existingPractitionerLineageIds,
                deletedPractitionerLineageIds,
              );

            if (isSameDefinition) {
              currentAppointmentTypeId = existingByLineage._id;
              return { status: "applied" as const };
            }

            return {
              message: `[HISTORY:APPOINTMENT_TYPE_LINEAGE_CONFLICT] Die Terminart mit lineageKey ${deletedSnapshot.lineageKey} existiert bereits, hat aber abweichende Einstellungen.`,
              status: "conflict" as const,
            };
          }

          const resolvedUndoPractitionerIds =
            resolvePractitionerIdsFromSnapshots(deletedPractitionerSnapshots);
          if ("status" in resolvedUndoPractitionerIds) {
            return resolvedUndoPractitionerIds;
          }

          const recreateResult = await createAppointmentTypeMutation({
            duration: deletedSnapshot.duration,
            expectedDraftRevision: getExpectedDraftRevision(),
            lineageKey: deletedSnapshot.lineageKey,
            name: deletedSnapshot.name,
            practiceId,
            practitionerIds: resolvedUndoPractitionerIds.ids,
            selectedRuleSetId: ruleSetId,
          });
          handleDraftMutationResult(recreateResult);
          currentAppointmentTypeId = recreateResult.entityId;
          return { status: "applied" as const };
        },
      });

      toast.success("Terminart gelöscht", {
        description: `Terminart "${appointmentType.name}" wurde erfolgreich gelöscht.`,
      });
    } catch (error: unknown) {
      toast.error("Fehler beim Löschen", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Package2 className="h-5 w-5" />
            <div>
              <CardTitle>Terminarten</CardTitle>
            </div>
          </div>
          <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Terminart hinzufügen
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingAppointmentType
                    ? "Terminart bearbeiten"
                    : "Neue Terminart hinzufügen"}
                </DialogTitle>
                <DialogDescription>
                  {editingAppointmentType
                    ? "Bearbeiten Sie die Terminart."
                    : "Erstellen Sie eine neue Terminart mit Namen und Dauer."}
                </DialogDescription>
              </DialogHeader>
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <FieldGroup>
                  <form.Field name="name">
                    {(field) => {
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor="appointment-type-name">
                            Name der Terminart
                          </FieldLabel>
                          <Input
                            aria-invalid={isInvalid}
                            id="appointment-type-name"
                            onBlur={field.handleBlur}
                            onChange={(e) => {
                              field.handleChange(e.target.value);
                            }}
                            placeholder="z.B. Erstgespräch, Kontrolltermin"
                            value={field.state.value}
                          />
                          <FieldError>
                            {field.state.meta.errors
                              .map((error) =>
                                typeof error === "string"
                                  ? error
                                  : (error?.message ?? ""),
                              )
                              .join(", ")}
                          </FieldError>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="duration">
                    {(field) => {
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor="appointment-type-duration">
                            Dauer (in Minuten)
                          </FieldLabel>
                          <Input
                            aria-invalid={isInvalid}
                            id="appointment-type-duration"
                            max={480}
                            min={5}
                            onBlur={field.handleBlur}
                            onChange={(e) => {
                              field.handleChange(Number(e.target.value));
                            }}
                            placeholder="30"
                            step={5}
                            type="number"
                            value={field.state.value}
                          />
                          <FieldError>
                            {field.state.meta.errors
                              .map((error) =>
                                typeof error === "string"
                                  ? error
                                  : (error?.message ?? ""),
                              )
                              .join(", ")}
                          </FieldError>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field mode="array" name="practitionerIds">
                    {(field) => {
                      const isInvalid =
                        field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <FieldSet>
                          <FieldLegend variant="label">
                            Behandler auswählen
                          </FieldLegend>
                          <FieldDescription>
                            Wählen Sie mindestens einen Behandler für diese
                            Terminart aus.
                          </FieldDescription>
                          <FieldGroup
                            className="gap-3"
                            data-invalid={isInvalid}
                          >
                            {practitionersQuery === undefined ? (
                              <div className="text-sm text-muted-foreground">
                                Lade Behandler...
                              </div>
                            ) : practitioners.length === 0 ? (
                              <div className="text-sm text-muted-foreground">
                                Keine Behandler verfügbar. Bitte erstellen Sie
                                zuerst Behandler.
                              </div>
                            ) : (
                              practitioners.map((practitioner) => (
                                <Field
                                  key={practitioner._id}
                                  orientation="horizontal"
                                >
                                  <Checkbox
                                    aria-invalid={isInvalid}
                                    checked={field.state.value.includes(
                                      practitioner._id,
                                    )}
                                    id={`practitioner-${practitioner._id}`}
                                    onBlur={field.handleBlur}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        field.pushValue(practitioner._id);
                                      } else {
                                        const index = field.state.value.indexOf(
                                          practitioner._id,
                                        );
                                        if (index !== -1) {
                                          field.removeValue(index);
                                        }
                                      }
                                    }}
                                  />
                                  <FieldLabel
                                    className="font-normal"
                                    htmlFor={`practitioner-${practitioner._id}`}
                                  >
                                    {practitioner.name}
                                  </FieldLabel>
                                </Field>
                              ))
                            )}
                          </FieldGroup>
                          <FieldError>
                            {field.state.meta.errors
                              .map((error) =>
                                typeof error === "string"
                                  ? error
                                  : (error?.message ?? ""),
                              )
                              .join(", ")}
                          </FieldError>
                        </FieldSet>
                      );
                    }}
                  </form.Field>
                </FieldGroup>

                <DialogFooter className="mt-6">
                  <Button onClick={closeDialog} type="button" variant="outline">
                    Abbrechen
                  </Button>
                  <form.Subscribe
                    selector={(state) => [state.canSubmit, state.isSubmitting]}
                  >
                    {([canSubmit, isSubmitting]) => (
                      <Button
                        disabled={!canSubmit || isSubmitting}
                        type="submit"
                      >
                        {isSubmitting
                          ? editingAppointmentType
                            ? "Aktualisiere..."
                            : "Erstelle..."
                          : editingAppointmentType
                            ? "Aktualisieren"
                            : "Erstellen"}
                      </Button>
                    )}
                  </form.Subscribe>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {appointmentTypesQuery === undefined ? (
          <div className="text-center py-4 text-muted-foreground">
            Lade Terminarten...
          </div>
        ) : appointmentTypes.length === 0 ? (
          <div className="text-center py-8">
            <Package2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <div className="text-muted-foreground">
              Noch keine Terminarten vorhanden
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {appointmentTypes.length} Terminarten verfügbar
            </div>

            <div className="grid gap-3">
              {appointmentTypes.map((appointmentType) => {
                // Get practitioner names for this appointment type
                const appointmentTypePractitioners =
                  appointmentType.allowedPractitionerIds
                    .map((practId) =>
                      practitioners.find((p) => p._id === practId),
                    )
                    .filter((p): p is NonNullable<typeof p> => p !== undefined);

                return (
                  <div
                    className="border rounded-lg p-3 flex items-start justify-between"
                    key={appointmentType._id}
                  >
                    <div className="flex-1">
                      <div className="font-medium mb-2">
                        {appointmentType.name}
                      </div>
                      <div className="text-sm text-muted-foreground mb-2">
                        Dauer: {appointmentType.duration} Minuten
                      </div>
                      {appointmentTypePractitioners.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {appointmentTypePractitioners.map((practitioner) => (
                            <Badge key={practitioner._id} variant="secondary">
                              {practitioner.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        onClick={() => {
                          openEditDialog(appointmentType);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => {
                          void handleDelete(appointmentType);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

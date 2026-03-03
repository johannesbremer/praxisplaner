import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  Package2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";

import type { LocalHistoryAction } from "../hooks/use-local-history";

import {
  registerLineageCreateHistoryAction,
  registerLineageUpdateHistoryAction,
} from "../utils/cow-history-actions";

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
type FollowUpPlanStep = NonNullable<AppointmentType["followUpPlan"]>[number];
type PractitionersResult =
  (typeof api.entities.getPractitioners)["_returnType"];
type PractitionerWithLineage = PractitionersResult[number];

const followUpStepSchema = z.object({
  appointmentTypeLineageKey: z
    .string()
    .min(1, "Bitte wählen Sie eine Terminart"),
  offsetUnit: z.enum(["minutes", "days", "weeks", "months"]),
  offsetValue: z
    .number()
    .int("Der Offset muss eine ganze Zahl sein")
    .min(0, "Der Offset darf nicht negativ sein")
    .refine((value) => value % 5 === 0, {
      message: "Der Offset muss in 5er-Schritten angegeben werden",
    }),
});
type FollowUpPlanFormStep = z.infer<typeof followUpStepSchema>;

const createEmptyFollowUpStep = (): FollowUpPlanFormStep => ({
  appointmentTypeLineageKey: "" as Id<"appointmentTypes">,
  offsetUnit: "days",
  offsetValue: 0,
});

const getFollowUpSearchMode = (
  step: FollowUpPlanFormStep,
): FollowUpPlanStep["searchMode"] => {
  if (step.offsetUnit !== "minutes") {
    return "first_available_on_or_after";
  }

  return step.offsetValue === 0 ? "exact_after_previous" : "same_day";
};

const normalizeFollowUpPlanForSubmit = (
  steps: FollowUpPlanFormStep[],
): FollowUpPlanStep[] | undefined => {
  if (steps.length === 0) {
    return undefined;
  }

  return steps.map((step, index) => ({
    appointmentTypeLineageKey:
      step.appointmentTypeLineageKey as Id<"appointmentTypes">,
    locationMode: "inherit",
    offsetUnit: step.offsetUnit,
    offsetValue: step.offsetValue,
    practitionerMode: "inherit",
    required: true,
    searchMode: getFollowUpSearchMode(step),
    stepId: `step-${index + 1}`,
  }));
};

const createFollowUpPlanCreateArgs = (
  followUpPlan: FollowUpPlanStep[] | undefined,
) => (followUpPlan === undefined ? {} : { followUpPlan });

const createFollowUpPlanUpdateArgs = (
  followUpPlan: FollowUpPlanStep[] | undefined,
) => ({ followUpPlan: followUpPlan ?? [] });

const formatFollowUpOffset = (step: {
  offsetUnit: FollowUpPlanStep["offsetUnit"];
  offsetValue: number;
}) => {
  const unitLabel =
    step.offsetUnit === "minutes"
      ? step.offsetValue === 1
        ? "Minute"
        : "Minuten"
      : step.offsetUnit === "days"
        ? step.offsetValue === 1
          ? "Tag"
          : "Tage"
        : step.offsetUnit === "weeks"
          ? step.offsetValue === 1
            ? "Woche"
            : "Wochen"
          : step.offsetValue === 1
            ? "Monat"
            : "Monate";

  return `${step.offsetValue} ${unitLabel}`;
};

const parseNumberInput = (valueAsNumber: number, fallback = 0) =>
  Number.isNaN(valueAsNumber) ? fallback : valueAsNumber;

const serializeFollowUpPlan = (steps: FollowUpPlanStep[] | undefined) =>
  JSON.stringify(
    (steps ?? []).map((step) => ({
      appointmentTypeLineageKey: step.appointmentTypeLineageKey,
      locationMode: step.locationMode,
      note: step.note ?? null,
      offsetUnit: step.offsetUnit,
      offsetValue: step.offsetValue,
      practitionerMode: step.practitionerMode,
      required: step.required,
      searchMode: step.searchMode,
      stepId: step.stepId,
    })),
  );

// Form schema using Zod
const formSchema = z.object({
  duration: z
    .number()
    .min(5, "Dauer muss mindestens 5 Minuten betragen")
    .max(480, "Dauer darf maximal 480 Minuten (8 Stunden) betragen")
    .refine((val) => val % 5 === 0, {
      message: "Dauer muss in 5-Minuten-Schritten angegeben werden",
    }),
  followUpPlan: z.array(followUpStepSchema),
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
  const appointmentTypesRef = useRef(appointmentTypes);
  useEffect(() => {
    appointmentTypesRef.current = appointmentTypes;
  }, [appointmentTypes]);
  const practitionersRef = useRef(practitioners);
  useEffect(() => {
    practitionersRef.current = practitioners;
  }, [practitioners]);
  const expectedDraftRevisionRef = useRef(expectedDraftRevision);
  useEffect(() => {
    expectedDraftRevisionRef.current = expectedDraftRevision;
  }, [expectedDraftRevision]);
  const selectedRuleSetIdRef = useRef(ruleSetId);
  useEffect(() => {
    selectedRuleSetIdRef.current = ruleSetId;
  }, [ruleSetId]);

  const getExpectedDraftRevision = () => expectedDraftRevisionRef.current;
  const getSelectedRuleSetId = () => selectedRuleSetIdRef.current;

  const handleDraftMutationResult = (result: {
    draftRevision: number;
    ruleSetId: Id<"ruleSets">;
  }) => {
    expectedDraftRevisionRef.current = result.draftRevision;
    selectedRuleSetIdRef.current = result.ruleSetId;
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
            `Regelset: ${getSelectedRuleSetId()}\n` +
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
            `Regelset: ${getSelectedRuleSetId()}\n` +
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
      followUpPlan: [] as FollowUpPlanFormStep[],
      name: "",
      practitionerIds: [] as string[],
    },
    onSubmit: async ({ value }) => {
      try {
        const trimmedName = value.name.trim();
        const normalizedFollowUpPlan = normalizeFollowUpPlanForSubmit(
          value.followUpPlan,
        );
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
          const appointmentTypeLineageKey = editingAppointmentType.lineageKey;
          const beforeState = {
            duration: editingAppointmentType.duration,
            followUpPlan: editingAppointmentType.followUpPlan,
            name: editingAppointmentType.name,
            practitionerIds: editingAppointmentType.allowedPractitionerIds,
          };
          const afterState = {
            duration: value.duration,
            followUpPlan: normalizedFollowUpPlan,
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
            selectedRuleSetId: getSelectedRuleSetId(),
            ...createFollowUpPlanUpdateArgs(normalizedFollowUpPlan),
          });
          handleDraftMutationResult(updateResult);
          registerLineageUpdateHistoryAction({
            entitiesRef: appointmentTypesRef,
            initialEntityId: updateResult.entityId,
            label: "Terminart aktualisiert",
            lineageKey: appointmentTypeLineageKey,
            onRegisterHistoryAction,
            redoMissingMessage:
              "Die Terminart wurde bereits gelöscht und kann nicht erneut angewendet werden.",
            runRedo: async (currentAppointmentTypeId) => {
              const resolvedRedoPractitionerIds =
                resolvePractitionerIdsFromSnapshots(afterPractitionerSnapshots);
              if ("status" in resolvedRedoPractitionerIds) {
                return resolvedRedoPractitionerIds;
              }

              const redoResult = await updateAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                duration: afterState.duration,
                expectedDraftRevision: getExpectedDraftRevision(),
                name: afterState.name,
                practiceId,
                practitionerIds: resolvedRedoPractitionerIds.ids,
                selectedRuleSetId: getSelectedRuleSetId(),
                ...createFollowUpPlanUpdateArgs(afterState.followUpPlan),
              });
              handleDraftMutationResult(redoResult);
              return { entityId: redoResult.entityId };
            },
            runUndo: async (currentAppointmentTypeId) => {
              const resolvedUndoPractitionerIds =
                resolvePractitionerIdsFromSnapshots(
                  beforePractitionerSnapshots,
                );
              if ("status" in resolvedUndoPractitionerIds) {
                return resolvedUndoPractitionerIds;
              }

              const undoResult = await updateAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                duration: beforeState.duration,
                expectedDraftRevision: getExpectedDraftRevision(),
                name: beforeState.name,
                practiceId,
                practitionerIds: resolvedUndoPractitionerIds.ids,
                selectedRuleSetId: getSelectedRuleSetId(),
                ...createFollowUpPlanUpdateArgs(beforeState.followUpPlan),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: undoResult.entityId };
            },
            undoMissingMessage:
              "Die Terminart wurde bereits gelöscht und kann nicht zurückgesetzt werden.",
            validateRedo: (current) => {
              if (
                current.name !== beforeState.name ||
                current.duration !== beforeState.duration ||
                serializeFollowUpPlan(current.followUpPlan) !==
                  serializeFollowUpPlan(beforeState.followUpPlan) ||
                !samePractitionerLineageIds(
                  practitionerLineageIdsForCurrentIds(
                    current.allowedPractitionerIds,
                  ),
                  toSnapshotLineageIds(beforePractitionerSnapshots),
                )
              ) {
                return "Die Terminart wurde zwischenzeitlich geändert und kann nicht erneut angewendet werden.";
              }
              return null;
            },
            validateUndo: (current) => {
              if (
                current.name !== afterState.name ||
                current.duration !== afterState.duration ||
                serializeFollowUpPlan(current.followUpPlan) !==
                  serializeFollowUpPlan(afterState.followUpPlan) ||
                !samePractitionerLineageIds(
                  practitionerLineageIdsForCurrentIds(
                    current.allowedPractitionerIds,
                  ),
                  toSnapshotLineageIds(afterPractitionerSnapshots),
                )
              ) {
                return "Die Terminart wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.";
              }
              return null;
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
            selectedRuleSetId: getSelectedRuleSetId(),
            ...createFollowUpPlanCreateArgs(normalizedFollowUpPlan),
          });
          handleDraftMutationResult(createResult);
          const { entityId } = createResult;

          const appointmentTypeLineageKey = entityId;

          registerLineageCreateHistoryAction({
            entitiesRef: appointmentTypesRef,
            initialEntityId: entityId,
            isMissingEntityError,
            label: "Terminart erstellt",
            lineageKey: appointmentTypeLineageKey,
            onRegisterHistoryAction,
            runCreate: async () => {
              const recreateResult = await createAppointmentTypeMutation({
                duration: value.duration,
                expectedDraftRevision: getExpectedDraftRevision(),
                lineageKey: appointmentTypeLineageKey,
                name: trimmedName,
                practiceId,
                practitionerIds: resolvedFormPractitionerIds.ids,
                selectedRuleSetId: getSelectedRuleSetId(),
                ...createFollowUpPlanCreateArgs(normalizedFollowUpPlan),
              });
              handleDraftMutationResult(recreateResult);
              return { entityId: recreateResult.entityId };
            },
            runDelete: async (currentAppointmentTypeId) => {
              const undoResult = await deleteAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                appointmentTypeLineageKey,
                expectedDraftRevision: getExpectedDraftRevision(),
                practiceId,
                selectedRuleSetId: getSelectedRuleSetId(),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: undoResult.entityId };
            },
            validateBeforeCreate: () => {
              const existingByName = appointmentTypesRef.current.find(
                (type) => type.name === trimmedName,
              );
              if (existingByName) {
                return `[HISTORY:APPOINTMENT_TYPE_NAME_CONFLICT] Die Terminart kann nicht wiederhergestellt werden, weil bereits eine andere Terminart mit dem Namen "${trimmedName}" existiert.`;
              }
              return null;
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
    form.setFieldValue(
      "followUpPlan",
      appointmentType.followUpPlan?.map((step) => ({
        appointmentTypeLineageKey: step.appointmentTypeLineageKey,
        offsetUnit: step.offsetUnit,
        offsetValue: step.offsetValue,
      })) ?? [],
    );
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
        followUpPlan: appointmentType.followUpPlan,
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
        selectedRuleSetId: getSelectedRuleSetId(),
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
              selectedRuleSetId: getSelectedRuleSetId(),
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
              serializeFollowUpPlan(existingByLineage.followUpPlan) ===
                serializeFollowUpPlan(deletedSnapshot.followUpPlan) &&
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
            selectedRuleSetId: getSelectedRuleSetId(),
            ...createFollowUpPlanCreateArgs(deletedSnapshot.followUpPlan),
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
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden">
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
                className="flex max-h-full flex-col overflow-hidden"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <div className="flex-1 overflow-y-auto pr-2">
                  <FieldGroup>
                    <form.Field name="name">
                      {(field) => {
                        const isInvalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid;

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
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid;

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
                                field.handleChange(
                                  parseNumberInput(
                                    e.target.valueAsNumber,
                                    field.state.value,
                                  ),
                                );
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

                    <form.Field mode="array" name="followUpPlan">
                      {(field) => {
                        const availableTargets = appointmentTypes.filter(
                          (appointmentType) =>
                            appointmentType.lineageKey !==
                            editingAppointmentType?.lineageKey,
                        );

                        return (
                          <FieldSet>
                            <FieldLegend variant="label">
                              Kettentermine
                            </FieldLegend>
                            <div className="space-y-3">
                              {field.state.value.length === 0 ? (
                                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                                  Keine Kettentermine konfiguriert.
                                </div>
                              ) : (
                                field.state.value.map((step, index) => {
                                  const selectedTargetExists =
                                    availableTargets.some(
                                      (appointmentType) =>
                                        appointmentType.lineageKey ===
                                        step.appointmentTypeLineageKey,
                                    );

                                  return (
                                    <form.Field
                                      key={`${index}-${step.appointmentTypeLineageKey}`}
                                      name={`followUpPlan[${index}]` as const}
                                    >
                                      {(itemField) => (
                                        <div className="rounded-lg border p-4 space-y-4">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-medium">
                                              Schritt {index + 1}
                                            </div>
                                            <div className="flex gap-1">
                                              <Button
                                                disabled={index === 0}
                                                onClick={() => {
                                                  if (index === 0) {
                                                    return;
                                                  }
                                                  const current =
                                                    itemField.state.value;
                                                  const previous =
                                                    field.state.value[
                                                      index - 1
                                                    ];
                                                  if (!previous) {
                                                    return;
                                                  }
                                                  itemField.handleChange(
                                                    previous,
                                                  );
                                                  field.replaceValue(
                                                    index - 1,
                                                    current,
                                                  );
                                                }}
                                                size="icon"
                                                type="button"
                                                variant="ghost"
                                              >
                                                <ArrowUp className="h-4 w-4" />
                                              </Button>
                                              <Button
                                                disabled={
                                                  index ===
                                                  field.state.value.length - 1
                                                }
                                                onClick={() => {
                                                  const current =
                                                    itemField.state.value;
                                                  const next =
                                                    field.state.value[
                                                      index + 1
                                                    ];
                                                  if (!next) {
                                                    return;
                                                  }
                                                  itemField.handleChange(next);
                                                  field.replaceValue(
                                                    index + 1,
                                                    current,
                                                  );
                                                }}
                                                size="icon"
                                                type="button"
                                                variant="ghost"
                                              >
                                                <ArrowDown className="h-4 w-4" />
                                              </Button>
                                              <Button
                                                onClick={() => {
                                                  field.removeValue(index);
                                                }}
                                                size="icon"
                                                type="button"
                                                variant="ghost"
                                              >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                              </Button>
                                            </div>
                                          </div>

                                          <div className="grid gap-4 md:grid-cols-3">
                                            <Field>
                                              <FieldLabel>Terminart</FieldLabel>
                                              <Select
                                                onValueChange={(value) => {
                                                  itemField.handleChange({
                                                    ...itemField.state.value,
                                                    appointmentTypeLineageKey:
                                                      value as Id<"appointmentTypes">,
                                                  });
                                                }}
                                                {...(selectedTargetExists
                                                  ? {
                                                      value:
                                                        itemField.state.value
                                                          .appointmentTypeLineageKey,
                                                    }
                                                  : {})}
                                              >
                                                <SelectTrigger>
                                                  <SelectValue placeholder="Terminart wählen" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {availableTargets.map(
                                                    (appointmentType) => (
                                                      <SelectItem
                                                        key={
                                                          appointmentType.lineageKey
                                                        }
                                                        value={
                                                          appointmentType.lineageKey
                                                        }
                                                      >
                                                        {appointmentType.name}
                                                      </SelectItem>
                                                    ),
                                                  )}
                                                </SelectContent>
                                              </Select>
                                            </Field>

                                            <Field>
                                              <FieldLabel>Versatz</FieldLabel>
                                              <Input
                                                min={0}
                                                onChange={(e) => {
                                                  itemField.handleChange({
                                                    ...itemField.state.value,
                                                    offsetValue:
                                                      parseNumberInput(
                                                        e.target.valueAsNumber,
                                                        itemField.state.value
                                                          .offsetValue,
                                                      ),
                                                  });
                                                }}
                                                step={5}
                                                type="number"
                                                value={
                                                  itemField.state.value
                                                    .offsetValue
                                                }
                                              />
                                            </Field>

                                            <Field>
                                              <FieldLabel>Einheit</FieldLabel>
                                              <Select
                                                onValueChange={(value) => {
                                                  itemField.handleChange({
                                                    ...itemField.state.value,
                                                    offsetUnit:
                                                      value as FollowUpPlanStep["offsetUnit"],
                                                  });
                                                }}
                                                value={
                                                  itemField.state.value
                                                    .offsetUnit
                                                }
                                              >
                                                <SelectTrigger>
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="minutes">
                                                    Minuten
                                                  </SelectItem>
                                                  <SelectItem value="days">
                                                    Tage
                                                  </SelectItem>
                                                  <SelectItem value="weeks">
                                                    Wochen
                                                  </SelectItem>
                                                  <SelectItem value="months">
                                                    Monate
                                                  </SelectItem>
                                                </SelectContent>
                                              </Select>
                                            </Field>
                                          </div>
                                        </div>
                                      )}
                                    </form.Field>
                                  );
                                })
                              )}

                              <Button
                                onClick={() => {
                                  field.pushValue(createEmptyFollowUpStep());
                                }}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Kettentermin hinzufügen
                              </Button>
                            </div>
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

                    <form.Field mode="array" name="practitionerIds">
                      {(field) => {
                        const isInvalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid;

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
                                          const index =
                                            field.state.value.indexOf(
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
                </div>

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
                      {(appointmentType.followUpPlan?.length ?? 0) > 0 && (
                        <div className="mb-2 space-y-1">
                          <div className="text-sm font-medium">
                            {appointmentType.followUpPlan?.length} Kettentermine
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {appointmentType.followUpPlan?.map((step) => {
                              const target = appointmentTypes.find(
                                (candidate) =>
                                  candidate.lineageKey ===
                                  step.appointmentTypeLineageKey,
                              );

                              if (!target) {
                                return null;
                              }

                              return (
                                <Badge key={step.stepId} variant="outline">
                                  {formatFollowUpOffset(step)} {"->"}{" "}
                                  {target.name}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      )}
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

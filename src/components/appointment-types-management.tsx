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
import { err, ok, Result } from "neverthrow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as z from "zod";

import type { Id } from "@/convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  PractitionerLineageKey,
} from "@/convex/identity";

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
import {
  asAppointmentTypeId,
  asAppointmentTypeLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
} from "@/convex/identity";
import { APPOINTMENT_TYPE_MISSING_ENTITY_REGEX } from "@/lib/typed-regex";

import type { LocalHistoryAction } from "../hooks/use-local-history";
import type {
  DraftMutationResult,
  RuleSetReplayTarget,
} from "../utils/cow-history";
import type { FrontendLineageEntity } from "../utils/frontend-lineage";

import { findIdInList } from "../utils/convex-ids";
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
import {
  findFrontendEntityByEntityId,
  requireFrontendLineageEntities,
} from "../utils/frontend-lineage";
type AppointmentType = FrontendLineageEntity<
  "appointmentTypes",
  AppointmentTypeQueryResult[number]
>;
interface AppointmentTypeFormValues {
  duration: number;
  followUpPlanVariants: FollowUpPlanVariantFormValue[];
  name: string;
  practitionerIds: Id<"practitioners">[];
}
type AppointmentTypeQueryResult =
  (typeof api.entities.getAppointmentTypes)["_returnType"];
interface AppointmentTypesManagementProps {
  onDraftMutation?: (result: DraftMutationResult) => void;
  onRegisterHistoryAction?: (action: LocalHistoryAction) => void;
  onRuleSetCreated?: (ruleSetId: Id<"ruleSets">) => void;
  practiceId: Id<"practices">;
  ruleSetReplayTarget: RuleSetReplayTarget;
}

type FollowUpPlanAnchorKind = FollowUpPlanStep["anchor"]["kind"];
type FollowUpPlanDateOffsetUnit = "days" | "months" | "weeks";
interface FollowUpPlanFormStep {
  anchorKind: FollowUpPlanAnchorKind;
  appointmentTypeLineageKey: FollowUpPlanTargetSelection;
  dateOffsetUnit: FollowUpPlanDateOffsetUnit;
  dateOffsetValue: number;
  locationMode: FollowUpPlanStep["locationMode"];
  note: string;
  offsetMinutes: number;
  practitionerMode: FollowUpPlanStep["practitionerMode"];
  required: boolean;
  searchMode: FollowUpPlanStep["searchMode"];
}
type FollowUpPlanStep = FollowUpPlanVariant["steps"][number];
type FollowUpPlanTargetSelection = "" | AppointmentTypeLineageKey;
type FollowUpPlanVariant = NonNullable<
  AppointmentType["followUpPlanVariants"]
>[number];
interface FollowUpPlanVariantFormValue {
  steps: FollowUpPlanFormStep[];
  title: string;
}

type Practitioner = FrontendLineageEntity<
  "practitioners",
  PractitionerQueryResult[number]
>;

type PractitionerQueryResult =
  (typeof api.entities.getPractitioners)["_returnType"];

const defaultAppointmentTypeFormValues: AppointmentTypeFormValues = {
  duration: 30,
  followUpPlanVariants: [],
  name: "",
  practitionerIds: [],
};

const createEmptyFollowUpStep = (): FollowUpPlanFormStep => ({
  anchorKind: "previousDate",
  appointmentTypeLineageKey: "",
  dateOffsetUnit: "days",
  dateOffsetValue: 1,
  locationMode: "inherit_root",
  note: "",
  offsetMinutes: 0,
  practitionerMode: "inherit_root",
  required: true,
  searchMode: "first_available_on_or_after",
});

const createEmptyFollowUpPlanVariant = (): FollowUpPlanVariantFormValue => ({
  steps: [createEmptyFollowUpStep()],
  title: "",
});

const normalizeMinutesOffset = (rawValue: number) => {
  const normalizedInteger = Number.isFinite(rawValue)
    ? Math.trunc(rawValue)
    : 0;

  return Math.max(0, Math.round(normalizedInteger / 5) * 5);
};

const normalizeDateOffsetValue = (rawValue: number) => {
  const normalizedInteger = Number.isFinite(rawValue)
    ? Math.trunc(rawValue)
    : 0;

  return Math.max(1, normalizedInteger);
};

const normalizeFollowUpPlanVariantsForSubmit = (
  variants: FollowUpPlanVariantFormValue[],
): Result<FollowUpPlanVariant[], string> => {
  if (variants.length === 0) {
    return ok([]);
  }

  return Result.combine(
    variants.map((variant, variantIndex) => {
      const trimmedTitle = variant.title.trim();
      if (trimmedTitle.length === 0) {
        return err("Jede Kettentermin-Variante benötigt einen Titel.");
      }

      return Result.combine(
        variant.steps.map((step, stepIndex) =>
          resolveSelectedAppointmentTypeLineageKey(step).map(
            (appointmentTypeLineageKey) => ({
              anchor: buildFollowUpStepAnchor(step),
              appointmentTypeLineageKey,
              locationMode: step.locationMode,
              ...(step.note.trim() ? { note: step.note.trim() } : {}),
              practitionerMode: step.practitionerMode,
              required: step.required,
              searchMode: step.searchMode,
              stepId: `step-${stepIndex + 1}`,
            }),
          ),
        ),
      ).map((steps) => ({
        steps,
        title: trimmedTitle,
        variantId: `variant-${variantIndex + 1}`,
      }));
    }),
  );
};

const createFollowUpPlanVariantCreateArgs = (
  followUpPlanVariants: FollowUpPlanVariant[] | undefined,
) => (followUpPlanVariants === undefined ? {} : { followUpPlanVariants });

const createFollowUpPlanVariantUpdateArgs = (
  followUpPlanVariants: FollowUpPlanVariant[] | undefined,
) => ({ followUpPlanVariants: followUpPlanVariants ?? [] });

const formatFollowUpStepSummary = (step: FollowUpPlanStep) => {
  const anchorDescription =
    step.anchor.kind === "previousDate"
      ? step.anchor.offsetDays === undefined
        ? step.anchor.offsetWeeks === undefined
          ? `${step.anchor.offsetMonths ?? 0} Monat${step.anchor.offsetMonths === 1 ? "" : "e"}`
          : `${step.anchor.offsetWeeks} Woche${step.anchor.offsetWeeks === 1 ? "" : "n"}`
        : `${step.anchor.offsetDays} Tag${step.anchor.offsetDays === 1 ? "" : "e"}`
      : `${step.anchor.offsetMinutes} Min`;

  const anchorLabel =
    step.anchor.kind === "previousEnd"
      ? "ab vorherigem Ende"
      : step.anchor.kind === "rootStart"
        ? "ab Root-Start"
        : step.anchor.kind === "rootEnd"
          ? "ab Root-Ende"
          : "ab vorherigem Datum";

  return `${anchorLabel}, ${anchorDescription}`;
};

const parseNumberInput = (valueAsNumber: number, fallback = 0) =>
  Number.isNaN(valueAsNumber) ? fallback : valueAsNumber;

const parseFollowUpDateOffsetUnit = (
  value: string,
): FollowUpPlanDateOffsetUnit | undefined => {
  switch (value) {
    case "days":
    case "months":
    case "weeks": {
      return value;
    }
    default: {
      return undefined;
    }
  }
};

const normalizeFollowUpPlanVariantsForForm = (
  followUpPlanVariants: FollowUpPlanVariant[] | undefined,
): FollowUpPlanVariantFormValue[] =>
  (followUpPlanVariants ?? []).map((variant) => ({
    steps: variant.steps.map((step) => ({
      anchorKind: step.anchor.kind,
      appointmentTypeLineageKey: asAppointmentTypeLineageKey(
        step.appointmentTypeLineageKey,
      ),
      dateOffsetUnit:
        step.anchor.kind === "previousDate"
          ? step.anchor.offsetWeeks === undefined
            ? step.anchor.offsetMonths === undefined
              ? "days"
              : "months"
            : "weeks"
          : "days",
      dateOffsetValue:
        step.anchor.kind === "previousDate"
          ? normalizeDateOffsetValue(
              step.anchor.offsetDays ??
                step.anchor.offsetWeeks ??
                step.anchor.offsetMonths ??
                1,
            )
          : 1,
      locationMode: step.locationMode,
      note: step.note ?? "",
      offsetMinutes:
        step.anchor.kind === "previousDate"
          ? 0
          : normalizeMinutesOffset(step.anchor.offsetMinutes),
      practitionerMode: step.practitionerMode,
      required: step.required,
      searchMode: step.searchMode,
    })),
    title: variant.title,
  }));

const serializeFollowUpPlanVariants = (
  variants: FollowUpPlanVariant[] | undefined,
) =>
  JSON.stringify(
    (variants ?? []).map((variant) => ({
      steps: variant.steps.map((step) => ({
        anchor: step.anchor,
        appointmentTypeLineageKey: step.appointmentTypeLineageKey,
        locationMode: step.locationMode,
        note: step.note ?? null,
        practitionerMode: step.practitionerMode,
        required: step.required,
        searchMode: step.searchMode,
        stepId: step.stepId,
      })),
      title: variant.title,
      variantId: variant.variantId,
    })),
  );

interface PractitionerHistorySnapshot {
  lineageId: PractitionerLineageKey;
  name: string;
}

function createAppointmentTypeFormSchema(params: {
  appointmentTypeLineageKeys: readonly AppointmentTypeLineageKey[];
  practitionerIds: readonly Id<"practitioners">[];
}) {
  return z.object({
    duration: z
      .number()
      .min(5, "Dauer muss mindestens 5 Minuten betragen")
      .max(480, "Dauer darf maximal 480 Minuten (8 Stunden) betragen")
      .refine((val) => val % 5 === 0, {
        message: "Dauer muss in 5-Minuten-Schritten angegeben werden",
      }),
    followUpPlanVariants: z.array(
      createFollowUpPlanVariantSchema(params.appointmentTypeLineageKeys),
    ),
    name: z
      .string()
      .trim()
      .min(2, "Name muss mindestens 2 Zeichen lang sein")
      .max(50, "Name darf maximal 50 Zeichen lang sein"),
    practitionerIds: z.array(
      createPractitionerIdSchema(params.practitionerIds),
    ),
  }) satisfies z.ZodType<AppointmentTypeFormValues>;
}

function createAppointmentTypeLineageSelectionSchema(
  availableLineageKeys: readonly AppointmentTypeLineageKey[],
) {
  return z
    .string()
    .transform((value, ctx): FollowUpPlanTargetSelection | typeof z.NEVER => {
      if (value === "") {
        return "";
      }

      const matchingLineageKey = availableLineageKeys.find(
        (lineageKey) => lineageKey === value,
      );
      if (!matchingLineageKey) {
        ctx.addIssue({
          code: "custom",
          message: "Bitte wählen Sie eine gültige Terminart",
        });
        return z.NEVER;
      }

      return matchingLineageKey;
    });
}

function createFollowUpPlanVariantSchema(
  availableLineageKeys: readonly AppointmentTypeLineageKey[],
) {
  return z.object({
    steps: z.array(createFollowUpStepSchema(availableLineageKeys)),
    title: z
      .string()
      .trim()
      .min(1, "Bitte geben Sie einen Titel für die Variante an"),
  });
}

function createFollowUpStepSchema(
  availableLineageKeys: readonly AppointmentTypeLineageKey[],
) {
  return z
    .object({
      anchorKind: z.enum([
        "previousEnd",
        "previousDate",
        "rootEnd",
        "rootStart",
      ]),
      appointmentTypeLineageKey: createAppointmentTypeLineageSelectionSchema(
        availableLineageKeys,
      ).refine((value) => value !== "", "Bitte wählen Sie eine Terminart"),
      dateOffsetUnit: z.enum(["days", "weeks", "months"]),
      dateOffsetValue: z
        .number()
        .int("Der Datumsversatz muss eine ganze Zahl sein"),
      locationMode: z.enum(["inherit_previous", "inherit_root", "any_allowed"]),
      note: z.string(),
      offsetMinutes: z
        .number()
        .int("Der Minutenversatz muss eine ganze Zahl sein"),
      practitionerMode: z.enum([
        "inherit_previous",
        "inherit_root",
        "any_allowed",
      ]),
      required: z.boolean(),
      searchMode: z.enum([
        "exact",
        "same_day_on_or_after",
        "first_available_on_or_after",
      ]),
    })
    .superRefine((step, ctx) => {
      if (step.anchorKind === "previousDate") {
        if (step.dateOffsetValue < 1) {
          ctx.addIssue({
            code: "custom",
            message: "Datumsversätze müssen mindestens 1 sein",
            path: ["dateOffsetValue"],
          });
        }
        return;
      }

      if (step.offsetMinutes < 0) {
        ctx.addIssue({
          code: "custom",
          message: "Minuten dürfen nicht negativ sein",
          path: ["offsetMinutes"],
        });
      }

      if (step.offsetMinutes % 5 !== 0) {
        ctx.addIssue({
          code: "custom",
          message: "Minuten müssen in 5er-Schritten angegeben werden",
          path: ["offsetMinutes"],
        });
      }
    });
}

function createPractitionerIdSchema(
  availablePractitionerIds: readonly Id<"practitioners">[],
) {
  return z
    .string()
    .transform((value, ctx): Id<"practitioners"> | typeof z.NEVER => {
      const practitionerId = findIdInList(availablePractitionerIds, value);
      if (!practitionerId) {
        ctx.addIssue({
          code: "custom",
          message: "Ungültiger Behandler",
        });
        return z.NEVER;
      }

      return practitionerId;
    });
}

const toSnapshotLineageIds = (snapshots: PractitionerHistorySnapshot[]) =>
  snapshots.map((snapshot) => snapshot.lineageId).toSorted();

const practitionerIdsFromSnapshots = (
  practitioners: readonly Practitioner[],
  snapshots: PractitionerHistorySnapshot[],
): { ids: Id<"practitioners">[] } | { message: string; status: "conflict" } => {
  const practitionerIdByLineageKey = new Map(
    practitioners.map((practitioner) => [
      practitioner.lineageKey,
      practitioner._id,
    ]),
  );
  const seen = new Set<Id<"practitioners">>();
  const ids: Id<"practitioners">[] = [];

  for (const snapshot of snapshots) {
    const practitionerId = practitionerIdByLineageKey.get(snapshot.lineageId);
    if (!practitionerId || seen.has(practitionerId)) {
      continue;
    }
    seen.add(practitionerId);
    ids.push(practitionerId);
  }

  return { ids };
};

const samePractitionerLineageIds = (
  left: PractitionerLineageKey[],
  right: PractitionerLineageKey[],
) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
};

const isMissingEntityError = (error: unknown) =>
  isMissingRuleSetEntityError(error, APPOINTMENT_TYPE_MISSING_ENTITY_REGEX);

const buildFollowUpStepAnchor = (
  step: FollowUpPlanFormStep,
): FollowUpPlanStep["anchor"] => {
  if (step.anchorKind === "previousDate") {
    const normalizedValue = normalizeDateOffsetValue(step.dateOffsetValue);
    return step.dateOffsetUnit === "weeks"
      ? { kind: "previousDate", offsetWeeks: normalizedValue }
      : step.dateOffsetUnit === "months"
        ? { kind: "previousDate", offsetMonths: normalizedValue }
        : { kind: "previousDate", offsetDays: normalizedValue };
  }

  return {
    kind: step.anchorKind,
    offsetMinutes: normalizeMinutesOffset(step.offsetMinutes),
  };
};

const resolveSelectedAppointmentTypeLineageKey = (
  step: FollowUpPlanFormStep,
): Result<AppointmentTypeLineageKey, string> => {
  if (step.appointmentTypeLineageKey === "") {
    return err("Bitte wählen Sie eine Terminart.");
  }

  return ok(step.appointmentTypeLineageKey);
};

export function AppointmentTypesManagement({
  onDraftMutation,
  onRegisterHistoryAction,
  onRuleSetCreated,
  practiceId,
  ruleSetReplayTarget,
}: AppointmentTypesManagementProps) {
  const ruleSetId = ruleSetIdFromReplayTarget(ruleSetReplayTarget);
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

  const appointmentTypes: AppointmentType[] = useMemo(() => {
    if (!appointmentTypesQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "appointmentTypes",
      AppointmentTypeQueryResult[number]
    >({
      entities: appointmentTypesQuery,
      entityType: "appointment type",
      source: "AppointmentTypesManagement",
    });
  }, [appointmentTypesQuery]);
  const practitioners: Practitioner[] = useMemo(() => {
    if (!practitionersQuery) {
      return [];
    }

    return requireFrontendLineageEntities<
      "practitioners",
      PractitionerQueryResult[number]
    >({
      entities: practitionersQuery,
      entityType: "practitioner",
      source: "AppointmentTypesManagement",
    });
  }, [practitionersQuery]);
  const formSchema = useMemo(
    () =>
      createAppointmentTypeFormSchema({
        appointmentTypeLineageKeys: appointmentTypes.map(
          (appointmentType) => appointmentType.lineageKey,
        ),
        practitionerIds: practitioners.map((practitioner) => practitioner._id),
      }),
    [appointmentTypes, practitioners],
  );
  const appointmentTypesRef = useRef(appointmentTypes);
  useEffect(() => {
    appointmentTypesRef.current = appointmentTypes;
  }, [appointmentTypes]);
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
  const upsertAppointmentTypeRef = useCallback(
    (
      appointmentType: AppointmentType,
      options?: {
        previousLineageKey?: AppointmentTypeLineageKey | undefined;
      },
    ) => {
      const next = [...appointmentTypesRef.current];
      const matchIndex = next.findIndex(
        (existing) =>
          existing._id === appointmentType._id ||
          existing.lineageKey === appointmentType.lineageKey ||
          (options?.previousLineageKey !== undefined &&
            existing.lineageKey === options.previousLineageKey),
      );

      if (matchIndex === -1) {
        next.push(appointmentType);
      } else {
        next[matchIndex] = appointmentType;
      }

      appointmentTypesRef.current = next;
    },
    [],
  );
  const removeAppointmentTypeFromRef = useCallback(
    (params: {
      id: Id<"appointmentTypes">;
      lineageKey?: AppointmentTypeLineageKey | undefined;
    }) => {
      appointmentTypesRef.current = appointmentTypesRef.current.filter(
        (existing) =>
          existing._id !== params.id &&
          (params.lineageKey === undefined ||
            existing.lineageKey !== params.lineageKey),
      );
    },
    [],
  );

  const resolvePractitionerLineageKey = (
    practitionerId: Id<"practitioners">,
  ): PractitionerLineageKey =>
    findFrontendEntityByEntityId(
      practitionersRef.current,
      asPractitionerId(practitionerId),
    )?.lineageKey ?? asPractitionerLineageKey(practitionerId);

  const resolvePractitionerIdForLineage = (
    practitionerLineageKey: PractitionerLineageKey,
  ): Id<"practitioners"> | undefined =>
    practitionersRef.current.find(
      (practitioner) => practitioner.lineageKey === practitionerLineageKey,
    )?._id;

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
      name: nameById.get(asPractitionerId(id)) ?? id,
    }));
  };

  const form = useForm({
    defaultValues: defaultAppointmentTypeFormValues,
    onSubmit: async ({ value }) => {
      try {
        const parseResult = formSchema.safeParse(value);
        if (!parseResult.success) {
          toast.error("Fehler beim Speichern", {
            description: "Bitte prüfen Sie die markierten Felder.",
          });
          return;
        }

        const parsedValue = parseResult.data;
        const normalizedFollowUpPlanVariants =
          normalizeFollowUpPlanVariantsForSubmit(
            parsedValue.followUpPlanVariants,
          ).match(
            (normalizedVariants) =>
              normalizedVariants.length === 0 ? undefined : normalizedVariants,
            (message) => {
              toast.error("Fehler beim Speichern", {
                description: message,
              });
              return null;
            },
          );
        if (normalizedFollowUpPlanVariants === null) {
          return;
        }
        const formPractitionerSnapshots = createPractitionerSnapshots(
          parsedValue.practitionerIds,
        );
        const resolvedFormPractitionerIds = practitionerIdsFromSnapshots(
          practitionersRef.current,
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
            followUpPlanVariants: editingAppointmentType.followUpPlanVariants,
            name: editingAppointmentType.name,
            practitionerLineageKeys:
              editingAppointmentType.allowedPractitionerLineageKeys.map(
                (lineageKey) => asPractitionerLineageKey(lineageKey),
              ),
          };
          const afterState = {
            duration: parsedValue.duration,
            followUpPlanVariants: normalizedFollowUpPlanVariants,
            name: parsedValue.name,
            practitionerLineageKeys: toSnapshotLineageIds(
              formPractitionerSnapshots,
            ),
          };
          const beforePractitionerSnapshots = createPractitionerSnapshots(
            beforeState.practitionerLineageKeys
              .map((lineageKey) => resolvePractitionerIdForLineage(lineageKey))
              .flatMap((practitionerId) =>
                practitionerId === undefined ? [] : [practitionerId],
              ),
          );
          const afterPractitionerSnapshots = createPractitionerSnapshots(
            resolvedFormPractitionerIds.ids,
          );

          // Update existing appointment type
          const updateResult = await updateAppointmentTypeMutation({
            appointmentTypeId: editingAppointmentType._id,
            duration: parsedValue.duration,
            name: parsedValue.name,
            practiceId,
            practitionerIds: resolvedFormPractitionerIds.ids,
            ...getCowMutationArgs(),
            ...createFollowUpPlanVariantUpdateArgs(
              normalizedFollowUpPlanVariants,
            ),
          });
          handleDraftMutationResult(updateResult);
          upsertAppointmentTypeRef(
            {
              ...editingAppointmentType,
              _id: asAppointmentTypeId(updateResult.entityId),
              allowedPractitionerLineageKeys:
                afterState.practitionerLineageKeys,
              duration: afterState.duration,
              followUpPlanVariants: afterState.followUpPlanVariants ?? [],
              name: afterState.name,
              ruleSetId: updateResult.ruleSetId,
            },
            { previousLineageKey: appointmentTypeLineageKey },
          );
          registerLineageUpdateHistoryAction({
            entitiesRef: appointmentTypesRef,
            initialEntityId: updateResult.entityId,
            label: "Terminart aktualisiert",
            lineageKey: appointmentTypeLineageKey,
            onRegisterHistoryAction,
            redoMissingMessage:
              "Die Terminart wurde bereits gelöscht und kann nicht erneut angewendet werden.",
            runRedo: async (currentAppointmentTypeId) => {
              const resolvedRedoPractitionerIds = practitionerIdsFromSnapshots(
                practitionersRef.current,
                afterPractitionerSnapshots,
              );
              if ("status" in resolvedRedoPractitionerIds) {
                return resolvedRedoPractitionerIds;
              }

              const redoResult = await updateAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                duration: afterState.duration,
                name: afterState.name,
                practiceId,
                practitionerIds: resolvedRedoPractitionerIds.ids,
                ...getCowMutationArgs(),
                ...createFollowUpPlanVariantUpdateArgs(
                  afterState.followUpPlanVariants,
                ),
              });
              handleDraftMutationResult(redoResult);
              return { entityId: redoResult.entityId };
            },
            runUndo: async (currentAppointmentTypeId) => {
              const resolvedUndoPractitionerIds = practitionerIdsFromSnapshots(
                practitionersRef.current,
                beforePractitionerSnapshots,
              );
              if ("status" in resolvedUndoPractitionerIds) {
                return resolvedUndoPractitionerIds;
              }

              const undoResult = await updateAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                duration: beforeState.duration,
                name: beforeState.name,
                practiceId,
                practitionerIds: resolvedUndoPractitionerIds.ids,
                ...getCowMutationArgs(),
                ...createFollowUpPlanVariantUpdateArgs(
                  beforeState.followUpPlanVariants,
                ),
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
                serializeFollowUpPlanVariants(current.followUpPlanVariants) !==
                  serializeFollowUpPlanVariants(
                    beforeState.followUpPlanVariants,
                  ) ||
                !samePractitionerLineageIds(
                  current.allowedPractitionerLineageKeys
                    .map((lineageKey) => asPractitionerLineageKey(lineageKey))
                    .toSorted(),
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
                serializeFollowUpPlanVariants(current.followUpPlanVariants) !==
                  serializeFollowUpPlanVariants(
                    afterState.followUpPlanVariants,
                  ) ||
                !samePractitionerLineageIds(
                  current.allowedPractitionerLineageKeys
                    .map((lineageKey) => asPractitionerLineageKey(lineageKey))
                    .toSorted(),
                  toSnapshotLineageIds(afterPractitionerSnapshots),
                )
              ) {
                return "Die Terminart wurde zwischenzeitlich geändert und kann nicht zurückgesetzt werden.";
              }
              return null;
            },
          });

          toast.success("Terminart aktualisiert", {
            description: `Terminart "${parsedValue.name}" wurde erfolgreich aktualisiert.`,
          });

          setIsDialogOpen(false);
          setEditingAppointmentType(null);
          form.reset();
        } else {
          // Create new appointment type
          const createResult = await createAppointmentTypeMutation({
            duration: parsedValue.duration,
            name: parsedValue.name,
            practiceId,
            practitionerIds: resolvedFormPractitionerIds.ids,
            ...getCowMutationArgs(),
            ...createFollowUpPlanVariantCreateArgs(
              normalizedFollowUpPlanVariants,
            ),
          });
          handleDraftMutationResult(createResult);
          const appointmentTypeLineageKey = asAppointmentTypeLineageKey(
            createResult.entityId,
          );
          upsertAppointmentTypeRef({
            _creationTime: 0,
            _id: asAppointmentTypeId(createResult.entityId),
            allowedPractitionerLineageKeys: toSnapshotLineageIds(
              formPractitionerSnapshots,
            ),
            createdAt: 0n,
            duration: parsedValue.duration,
            followUpPlanVariants: normalizedFollowUpPlanVariants ?? [],
            lastModified: 0n,
            lineageKey: appointmentTypeLineageKey,
            name: parsedValue.name,
            practiceId,
            ruleSetId: createResult.ruleSetId,
          });
          const { entityId } = createResult;

          registerLineageCreateHistoryAction({
            entitiesRef: appointmentTypesRef,
            initialEntityId: entityId,
            isMissingEntityError,
            label: "Terminart erstellt",
            lineageKey: appointmentTypeLineageKey,
            onRegisterHistoryAction,
            runCreate: async () => {
              const recreateResult = await createAppointmentTypeMutation({
                duration: parsedValue.duration,
                lineageKey: appointmentTypeLineageKey,
                name: parsedValue.name,
                practiceId,
                practitionerIds: resolvedFormPractitionerIds.ids,
                ...getCowMutationArgs(),
                ...createFollowUpPlanVariantCreateArgs(
                  normalizedFollowUpPlanVariants,
                ),
              });
              handleDraftMutationResult(recreateResult);
              return { entityId: recreateResult.entityId };
            },
            runDelete: async (currentAppointmentTypeId) => {
              const undoResult = await deleteAppointmentTypeMutation({
                appointmentTypeId: currentAppointmentTypeId,
                appointmentTypeLineageKey,
                practiceId,
                ...getCowMutationArgs(),
              });
              handleDraftMutationResult(undoResult);
              return { entityId: undoResult.entityId };
            },
            validateBeforeCreate: () => {
              const existingByName = appointmentTypesRef.current.find(
                (type) => type.name === parsedValue.name,
              );
              if (existingByName) {
                return `[HISTORY:APPOINTMENT_TYPE_NAME_CONFLICT] Die Terminart kann nicht wiederhergestellt werden, weil bereits eine andere Terminart mit dem Namen "${parsedValue.name}" existiert.`;
              }
              return null;
            },
          });

          toast.success("Terminart erstellt", {
            description: `Terminart "${parsedValue.name}" wurde erfolgreich erstellt.`,
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
      onSubmit: ({ value }) => {
        const result = formSchema.safeParse(value);
        return result.success ? undefined : result.error;
      },
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
    const validPractitionerIds =
      appointmentType.allowedPractitionerLineageKeys.flatMap((lineageKey) => {
        const practitionerId = resolvePractitionerIdForLineage(
          asPractitionerLineageKey(lineageKey),
        );
        return practitionerId === undefined ? [] : [practitionerId];
      });

    setEditingAppointmentType(appointmentType);
    form.setFieldValue("name", appointmentType.name);
    form.setFieldValue("duration", appointmentType.duration);
    form.setFieldValue(
      "followUpPlanVariants",
      normalizeFollowUpPlanVariantsForForm(
        appointmentType.followUpPlanVariants,
      ),
    );
    form.setFieldValue("practitionerIds", validPractitionerIds);

    if (
      validPractitionerIds.length !==
      appointmentType.allowedPractitionerLineageKeys.length
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
        followUpPlanVariants: appointmentType.followUpPlanVariants,
        lineageKey: appointmentType.lineageKey,
        name: appointmentType.name,
        practitionerLineageKeys:
          appointmentType.allowedPractitionerLineageKeys.map((lineageKey) =>
            asPractitionerLineageKey(lineageKey),
          ),
      };
      const deletedPractitionerSnapshots = createPractitionerSnapshots(
        deletedSnapshot.practitionerLineageKeys
          .map((lineageKey) => resolvePractitionerIdForLineage(lineageKey))
          .flatMap((practitionerId) =>
            practitionerId === undefined ? [] : [practitionerId],
          ),
      );

      const deleteResult = await deleteAppointmentTypeMutation({
        appointmentTypeId: appointmentType._id,
        appointmentTypeLineageKey: deletedSnapshot.lineageKey,
        practiceId,
        ...getCowMutationArgs(),
      });
      handleDraftMutationResult(deleteResult);
      removeAppointmentTypeFromRef({
        id: appointmentType._id,
        lineageKey: deletedSnapshot.lineageKey,
      });

      let currentAppointmentTypeId = appointmentType._id;

      onRegisterHistoryAction?.({
        label: "Terminart gelöscht",
        redo: async () => {
          try {
            const redoResult = await deleteAppointmentTypeMutation({
              appointmentTypeId: currentAppointmentTypeId,
              appointmentTypeLineageKey: deletedSnapshot.lineageKey,
              practiceId,
              ...getCowMutationArgs(),
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
          const { selectedRuleSetId } = getCowMutationArgs();
          const existingByLineage = appointmentTypesRef.current.find(
            (type) =>
              type.lineageKey === deletedSnapshot.lineageKey &&
              type.ruleSetId === selectedRuleSetId,
          );
          if (existingByLineage) {
            const existingPractitionerLineageIds =
              existingByLineage.allowedPractitionerLineageKeys
                .map((lineageKey) => asPractitionerLineageKey(lineageKey))
                .toSorted();
            const deletedPractitionerLineageIds = toSnapshotLineageIds(
              deletedPractitionerSnapshots,
            );
            const isSameDefinition =
              existingByLineage.duration === deletedSnapshot.duration &&
              serializeFollowUpPlanVariants(
                existingByLineage.followUpPlanVariants,
              ) ===
                serializeFollowUpPlanVariants(
                  deletedSnapshot.followUpPlanVariants,
                ) &&
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

          const resolvedUndoPractitionerIds = practitionerIdsFromSnapshots(
            practitionersRef.current,
            deletedPractitionerSnapshots,
          );
          if ("status" in resolvedUndoPractitionerIds) {
            return resolvedUndoPractitionerIds;
          }

          const recreateResult = await createAppointmentTypeMutation({
            duration: deletedSnapshot.duration,
            lineageKey: deletedSnapshot.lineageKey,
            name: deletedSnapshot.name,
            practiceId,
            practitionerIds: resolvedUndoPractitionerIds.ids,
            ...getCowMutationArgs(),
            ...createFollowUpPlanVariantCreateArgs(
              deletedSnapshot.followUpPlanVariants,
            ),
          });
          handleDraftMutationResult(recreateResult);
          upsertAppointmentTypeRef({
            _creationTime: 0,
            _id: asAppointmentTypeId(recreateResult.entityId),
            allowedPractitionerLineageKeys: toSnapshotLineageIds(
              deletedPractitionerSnapshots,
            ),
            createdAt: 0n,
            duration: deletedSnapshot.duration,
            followUpPlanVariants: deletedSnapshot.followUpPlanVariants ?? [],
            lastModified: 0n,
            lineageKey: deletedSnapshot.lineageKey,
            name: deletedSnapshot.name,
            practiceId,
            ruleSetId: recreateResult.ruleSetId,
          });
          currentAppointmentTypeId = asAppointmentTypeId(
            recreateResult.entityId,
          );
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
                            <FieldError errors={field.state.meta.errors} />
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
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        );
                      }}
                    </form.Field>

                    <form.Field mode="array" name="followUpPlanVariants">
                      {(field) => {
                        const availableTargets = appointmentTypes.filter(
                          (appointmentType) =>
                            appointmentType.lineageKey !==
                            editingAppointmentType?.lineageKey,
                        );

                        return (
                          <FieldSet>
                            <FieldLegend variant="label">
                              Kettentermin-Varianten
                            </FieldLegend>
                            <div className="space-y-3">
                              {field.state.value.length === 0 ? (
                                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                                  Keine Kettentermin-Varianten konfiguriert.
                                </div>
                              ) : (
                                field.state.value.map(
                                  (_variant, variantIndex) => (
                                    <form.Field
                                      key={`variant-${variantIndex}`}
                                      name={
                                        `followUpPlanVariants[${variantIndex}]` as const
                                      }
                                    >
                                      {(variantField) => (
                                        <div className="rounded-lg border p-4 space-y-4">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-medium">
                                              Variante {variantIndex + 1}
                                            </div>
                                            <div className="flex gap-1">
                                              <Button
                                                disabled={variantIndex === 0}
                                                onClick={() => {
                                                  if (variantIndex === 0) {
                                                    return;
                                                  }
                                                  const current =
                                                    variantField.state.value;
                                                  const previous =
                                                    field.state.value[
                                                      variantIndex - 1
                                                    ];
                                                  if (!previous) {
                                                    return;
                                                  }
                                                  variantField.handleChange(
                                                    previous,
                                                  );
                                                  field.replaceValue(
                                                    variantIndex - 1,
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
                                                  variantIndex ===
                                                  field.state.value.length - 1
                                                }
                                                onClick={() => {
                                                  const current =
                                                    variantField.state.value;
                                                  const next =
                                                    field.state.value[
                                                      variantIndex + 1
                                                    ];
                                                  if (!next) {
                                                    return;
                                                  }
                                                  variantField.handleChange(
                                                    next,
                                                  );
                                                  field.replaceValue(
                                                    variantIndex + 1,
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
                                                  field.removeValue(
                                                    variantIndex,
                                                  );
                                                }}
                                                size="icon"
                                                type="button"
                                                variant="ghost"
                                              >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                              </Button>
                                            </div>
                                          </div>

                                          <Field>
                                            <FieldLabel>Titel</FieldLabel>
                                            <Input
                                              onChange={(e) => {
                                                variantField.handleChange({
                                                  ...variantField.state.value,
                                                  title: e.target.value,
                                                });
                                              }}
                                              placeholder="z.B. mit Fußuntersuchung"
                                              value={
                                                variantField.state.value.title
                                              }
                                            />
                                          </Field>

                                          <form.Field
                                            mode="array"
                                            name={
                                              `followUpPlanVariants[${variantIndex}].steps` as const
                                            }
                                          >
                                            {(stepsField) => (
                                              <div className="space-y-3">
                                                {stepsField.state.value.map(
                                                  (step, stepIndex) => {
                                                    const selectedTargetExists =
                                                      availableTargets.some(
                                                        (appointmentType) =>
                                                          appointmentType.lineageKey ===
                                                          step.appointmentTypeLineageKey,
                                                      );

                                                    return (
                                                      <form.Field
                                                        key={`step-${stepIndex}`}
                                                        name={
                                                          `followUpPlanVariants[${variantIndex}].steps[${stepIndex}]` as const
                                                        }
                                                      >
                                                        {(itemField) => (
                                                          <div className="rounded-lg border p-4 space-y-4">
                                                            <div className="flex items-center justify-between gap-2">
                                                              <div className="text-sm font-medium">
                                                                Schritt{" "}
                                                                {stepIndex + 1}
                                                              </div>
                                                              <div className="flex gap-1">
                                                                <Button
                                                                  disabled={
                                                                    stepIndex ===
                                                                    0
                                                                  }
                                                                  onClick={() => {
                                                                    if (
                                                                      stepIndex ===
                                                                      0
                                                                    ) {
                                                                      return;
                                                                    }
                                                                    const current =
                                                                      itemField
                                                                        .state
                                                                        .value;
                                                                    const previous =
                                                                      stepsField
                                                                        .state
                                                                        .value[
                                                                        stepIndex -
                                                                          1
                                                                      ];
                                                                    if (
                                                                      !previous
                                                                    ) {
                                                                      return;
                                                                    }
                                                                    itemField.handleChange(
                                                                      previous,
                                                                    );
                                                                    stepsField.replaceValue(
                                                                      stepIndex -
                                                                        1,
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
                                                                    stepIndex ===
                                                                    stepsField
                                                                      .state
                                                                      .value
                                                                      .length -
                                                                      1
                                                                  }
                                                                  onClick={() => {
                                                                    const current =
                                                                      itemField
                                                                        .state
                                                                        .value;
                                                                    const next =
                                                                      stepsField
                                                                        .state
                                                                        .value[
                                                                        stepIndex +
                                                                          1
                                                                      ];
                                                                    if (!next) {
                                                                      return;
                                                                    }
                                                                    itemField.handleChange(
                                                                      next,
                                                                    );
                                                                    stepsField.replaceValue(
                                                                      stepIndex +
                                                                        1,
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
                                                                    stepsField.removeValue(
                                                                      stepIndex,
                                                                    );
                                                                  }}
                                                                  size="icon"
                                                                  type="button"
                                                                  variant="ghost"
                                                                >
                                                                  <Trash2 className="h-4 w-4 text-destructive" />
                                                                </Button>
                                                              </div>
                                                            </div>

                                                            <div className="grid gap-4 md:grid-cols-2">
                                                              <Field>
                                                                <FieldLabel>
                                                                  Terminart
                                                                </FieldLabel>
                                                                <Select
                                                                  onValueChange={(
                                                                    value,
                                                                  ) => {
                                                                    const selectedAppointmentType =
                                                                      availableTargets.find(
                                                                        (
                                                                          appointmentType,
                                                                        ) =>
                                                                          appointmentType.lineageKey ===
                                                                          value,
                                                                      );
                                                                    itemField.handleChange(
                                                                      {
                                                                        ...itemField
                                                                          .state
                                                                          .value,
                                                                        appointmentTypeLineageKey:
                                                                          selectedAppointmentType?.lineageKey ??
                                                                          "",
                                                                      },
                                                                    );
                                                                  }}
                                                                  {...(selectedTargetExists
                                                                    ? {
                                                                        value:
                                                                          itemField
                                                                            .state
                                                                            .value
                                                                            .appointmentTypeLineageKey,
                                                                      }
                                                                    : {})}
                                                                >
                                                                  <SelectTrigger>
                                                                    <SelectValue placeholder="Terminart wählen" />
                                                                  </SelectTrigger>
                                                                  <SelectContent>
                                                                    {availableTargets.map(
                                                                      (
                                                                        appointmentType,
                                                                      ) => (
                                                                        <SelectItem
                                                                          key={
                                                                            appointmentType.lineageKey
                                                                          }
                                                                          value={
                                                                            appointmentType.lineageKey
                                                                          }
                                                                        >
                                                                          {
                                                                            appointmentType.name
                                                                          }
                                                                        </SelectItem>
                                                                      ),
                                                                    )}
                                                                  </SelectContent>
                                                                </Select>
                                                              </Field>

                                                              <Field>
                                                                <FieldLabel>
                                                                  Anker
                                                                </FieldLabel>
                                                                <Select
                                                                  onValueChange={(
                                                                    value,
                                                                  ) => {
                                                                    const nextAnchorKind =
                                                                      value as FollowUpPlanAnchorKind;
                                                                    itemField.handleChange(
                                                                      {
                                                                        ...itemField
                                                                          .state
                                                                          .value,
                                                                        anchorKind:
                                                                          nextAnchorKind,
                                                                        searchMode:
                                                                          nextAnchorKind ===
                                                                          "previousDate"
                                                                            ? "first_available_on_or_after"
                                                                            : itemField
                                                                                  .state
                                                                                  .value
                                                                                  .offsetMinutes ===
                                                                                0
                                                                              ? "exact"
                                                                              : "same_day_on_or_after",
                                                                      },
                                                                    );
                                                                  }}
                                                                  value={
                                                                    itemField
                                                                      .state
                                                                      .value
                                                                      .anchorKind
                                                                  }
                                                                >
                                                                  <SelectTrigger>
                                                                    <SelectValue />
                                                                  </SelectTrigger>
                                                                  <SelectContent>
                                                                    <SelectItem value="previousEnd">
                                                                      Vorheriges
                                                                      Ende
                                                                    </SelectItem>
                                                                    <SelectItem value="previousDate">
                                                                      Vorheriges
                                                                      Datum
                                                                    </SelectItem>
                                                                    <SelectItem value="rootStart">
                                                                      Root-Start
                                                                    </SelectItem>
                                                                    <SelectItem value="rootEnd">
                                                                      Root-Ende
                                                                    </SelectItem>
                                                                  </SelectContent>
                                                                </Select>
                                                              </Field>

                                                              {itemField.state
                                                                .value
                                                                .anchorKind ===
                                                              "previousDate" ? (
                                                                <>
                                                                  <Field>
                                                                    <FieldLabel>
                                                                      Datumsversatz
                                                                    </FieldLabel>
                                                                    <Input
                                                                      min={1}
                                                                      onChange={(
                                                                        e,
                                                                      ) => {
                                                                        itemField.handleChange(
                                                                          {
                                                                            ...itemField
                                                                              .state
                                                                              .value,
                                                                            dateOffsetValue:
                                                                              parseNumberInput(
                                                                                e
                                                                                  .target
                                                                                  .valueAsNumber,
                                                                                itemField
                                                                                  .state
                                                                                  .value
                                                                                  .dateOffsetValue,
                                                                              ),
                                                                          },
                                                                        );
                                                                      }}
                                                                      step={1}
                                                                      type="number"
                                                                      value={
                                                                        itemField
                                                                          .state
                                                                          .value
                                                                          .dateOffsetValue
                                                                      }
                                                                    />
                                                                  </Field>
                                                                  <Field>
                                                                    <FieldLabel>
                                                                      Einheit
                                                                    </FieldLabel>
                                                                    <Select
                                                                      onValueChange={(
                                                                        value,
                                                                      ) => {
                                                                        const nextUnit =
                                                                          parseFollowUpDateOffsetUnit(
                                                                            value,
                                                                          );
                                                                        if (
                                                                          !nextUnit
                                                                        ) {
                                                                          return;
                                                                        }
                                                                        itemField.handleChange(
                                                                          {
                                                                            ...itemField
                                                                              .state
                                                                              .value,
                                                                            dateOffsetUnit:
                                                                              nextUnit,
                                                                          },
                                                                        );
                                                                      }}
                                                                      value={
                                                                        itemField
                                                                          .state
                                                                          .value
                                                                          .dateOffsetUnit
                                                                      }
                                                                    >
                                                                      <SelectTrigger>
                                                                        <SelectValue />
                                                                      </SelectTrigger>
                                                                      <SelectContent>
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
                                                                </>
                                                              ) : (
                                                                <Field>
                                                                  <FieldLabel>
                                                                    Minutenversatz
                                                                  </FieldLabel>
                                                                  <Input
                                                                    min={0}
                                                                    onChange={(
                                                                      e,
                                                                    ) => {
                                                                      itemField.handleChange(
                                                                        {
                                                                          ...itemField
                                                                            .state
                                                                            .value,
                                                                          offsetMinutes:
                                                                            parseNumberInput(
                                                                              e
                                                                                .target
                                                                                .valueAsNumber,
                                                                              itemField
                                                                                .state
                                                                                .value
                                                                                .offsetMinutes,
                                                                            ),
                                                                        },
                                                                      );
                                                                    }}
                                                                    step={5}
                                                                    type="number"
                                                                    value={
                                                                      itemField
                                                                        .state
                                                                        .value
                                                                        .offsetMinutes
                                                                    }
                                                                  />
                                                                </Field>
                                                              )}

                                                              <Field>
                                                                <FieldLabel>
                                                                  Suche
                                                                </FieldLabel>
                                                                <Select
                                                                  onValueChange={(
                                                                    value,
                                                                  ) => {
                                                                    itemField.handleChange(
                                                                      {
                                                                        ...itemField
                                                                          .state
                                                                          .value,
                                                                        searchMode:
                                                                          value as FollowUpPlanStep["searchMode"],
                                                                      },
                                                                    );
                                                                  }}
                                                                  value={
                                                                    itemField
                                                                      .state
                                                                      .value
                                                                      .searchMode
                                                                  }
                                                                >
                                                                  <SelectTrigger>
                                                                    <SelectValue />
                                                                  </SelectTrigger>
                                                                  <SelectContent>
                                                                    <SelectItem value="exact">
                                                                      Exakt
                                                                    </SelectItem>
                                                                    <SelectItem value="same_day_on_or_after">
                                                                      Gleicher
                                                                      Tag ab
                                                                      Uhrzeit
                                                                    </SelectItem>
                                                                    <SelectItem value="first_available_on_or_after">
                                                                      Erste
                                                                      Verfügbarkeit
                                                                      ab Datum
                                                                    </SelectItem>
                                                                  </SelectContent>
                                                                </Select>
                                                              </Field>

                                                              <Field>
                                                                <FieldLabel>
                                                                  Behandler
                                                                </FieldLabel>
                                                                <Select
                                                                  onValueChange={(
                                                                    value,
                                                                  ) => {
                                                                    itemField.handleChange(
                                                                      {
                                                                        ...itemField
                                                                          .state
                                                                          .value,
                                                                        practitionerMode:
                                                                          value as FollowUpPlanStep["practitionerMode"],
                                                                      },
                                                                    );
                                                                  }}
                                                                  value={
                                                                    itemField
                                                                      .state
                                                                      .value
                                                                      .practitionerMode
                                                                  }
                                                                >
                                                                  <SelectTrigger>
                                                                    <SelectValue />
                                                                  </SelectTrigger>
                                                                  <SelectContent>
                                                                    <SelectItem value="inherit_root">
                                                                      Root
                                                                      übernehmen
                                                                    </SelectItem>
                                                                    <SelectItem value="inherit_previous">
                                                                      Vorherigen
                                                                      übernehmen
                                                                    </SelectItem>
                                                                    <SelectItem value="any_allowed">
                                                                      Beliebig
                                                                      erlaubt
                                                                    </SelectItem>
                                                                  </SelectContent>
                                                                </Select>
                                                              </Field>

                                                              <Field>
                                                                <FieldLabel>
                                                                  Standort
                                                                </FieldLabel>
                                                                <Select
                                                                  onValueChange={(
                                                                    value,
                                                                  ) => {
                                                                    itemField.handleChange(
                                                                      {
                                                                        ...itemField
                                                                          .state
                                                                          .value,
                                                                        locationMode:
                                                                          value as FollowUpPlanStep["locationMode"],
                                                                      },
                                                                    );
                                                                  }}
                                                                  value={
                                                                    itemField
                                                                      .state
                                                                      .value
                                                                      .locationMode
                                                                  }
                                                                >
                                                                  <SelectTrigger>
                                                                    <SelectValue />
                                                                  </SelectTrigger>
                                                                  <SelectContent>
                                                                    <SelectItem value="inherit_root">
                                                                      Root
                                                                      übernehmen
                                                                    </SelectItem>
                                                                    <SelectItem value="inherit_previous">
                                                                      Vorherigen
                                                                      übernehmen
                                                                    </SelectItem>
                                                                    <SelectItem value="any_allowed">
                                                                      Beliebig
                                                                      erlaubt
                                                                    </SelectItem>
                                                                  </SelectContent>
                                                                </Select>
                                                              </Field>
                                                            </div>

                                                            <Field orientation="horizontal">
                                                              <Checkbox
                                                                checked={
                                                                  itemField
                                                                    .state.value
                                                                    .required
                                                                }
                                                                id={`required-${variantIndex}-${stepIndex}`}
                                                                onCheckedChange={(
                                                                  checked,
                                                                ) => {
                                                                  itemField.handleChange(
                                                                    {
                                                                      ...itemField
                                                                        .state
                                                                        .value,
                                                                      required:
                                                                        checked ===
                                                                        true,
                                                                    },
                                                                  );
                                                                }}
                                                              />
                                                              <FieldLabel
                                                                className="font-normal"
                                                                htmlFor={`required-${variantIndex}-${stepIndex}`}
                                                              >
                                                                Schritt ist
                                                                erforderlich
                                                              </FieldLabel>
                                                            </Field>

                                                            <Field>
                                                              <FieldLabel>
                                                                Notiz
                                                              </FieldLabel>
                                                              <Input
                                                                onChange={(
                                                                  e,
                                                                ) => {
                                                                  itemField.handleChange(
                                                                    {
                                                                      ...itemField
                                                                        .state
                                                                        .value,
                                                                      note: e
                                                                        .target
                                                                        .value,
                                                                    },
                                                                  );
                                                                }}
                                                                placeholder="Optional"
                                                                value={
                                                                  itemField
                                                                    .state.value
                                                                    .note
                                                                }
                                                              />
                                                            </Field>
                                                          </div>
                                                        )}
                                                      </form.Field>
                                                    );
                                                  },
                                                )}

                                                <Button
                                                  onClick={() => {
                                                    stepsField.pushValue(
                                                      createEmptyFollowUpStep(),
                                                    );
                                                  }}
                                                  size="sm"
                                                  type="button"
                                                  variant="outline"
                                                >
                                                  <Plus className="h-4 w-4 mr-2" />
                                                  Schritt hinzufügen
                                                </Button>
                                              </div>
                                            )}
                                          </form.Field>
                                        </div>
                                      )}
                                    </form.Field>
                                  ),
                                )
                              )}

                              <Button
                                onClick={() => {
                                  field.pushValue(
                                    createEmptyFollowUpPlanVariant(),
                                  );
                                }}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Variante hinzufügen
                              </Button>
                            </div>
                            <FieldError errors={field.state.meta.errors} />
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
                              Wählen Sie die Behandler aus, die diese Terminart
                              anbieten.
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
                            <FieldError errors={field.state.meta.errors} />
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
                  appointmentType.allowedPractitionerLineageKeys
                    .map((practitionerLineageKey) =>
                      practitioners.find(
                        (practitioner) =>
                          practitioner.lineageKey === practitionerLineageKey,
                      ),
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
                      {(appointmentType.followUpPlanVariants?.length ?? 0) >
                        0 && (
                        <div className="mb-2 space-y-1">
                          <div className="text-sm font-medium">
                            {appointmentType.followUpPlanVariants?.length}{" "}
                            Varianten
                          </div>
                          <div className="space-y-2">
                            {appointmentType.followUpPlanVariants?.map(
                              (variant) => (
                                <div key={variant.variantId}>
                                  <div className="text-sm">{variant.title}</div>
                                  <div className="flex flex-wrap gap-1.5 mt-1">
                                    {variant.steps.map((step) => {
                                      const target = appointmentTypes.find(
                                        (candidate) =>
                                          candidate.lineageKey ===
                                          step.appointmentTypeLineageKey,
                                      );

                                      if (!target) {
                                        return null;
                                      }

                                      return (
                                        <Badge
                                          key={`${variant.variantId}-${step.stepId}`}
                                          variant="outline"
                                        >
                                          {formatFollowUpStepSummary(step)}{" "}
                                          {"->"} {target.name}
                                        </Badge>
                                      );
                                    })}
                                  </div>
                                </div>
                              ),
                            )}
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

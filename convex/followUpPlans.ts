import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { Infer } from "convex/values";

import { ConvexError, v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { AppointmentTypeLineageKey } from "./identity";

import { asAppointmentTypeLineageKey } from "./identity";

type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export const followUpSearchModeValidator = v.union(
  v.literal("exact"),
  v.literal("same_day_on_or_after"),
  v.literal("first_available_on_or_after"),
);

export const followUpPractitionerModeValidator = v.union(
  v.literal("inherit_previous"),
  v.literal("inherit_root"),
  v.literal("any_allowed"),
);

export const followUpLocationModeValidator = v.union(
  v.literal("inherit_previous"),
  v.literal("inherit_root"),
  v.literal("any_allowed"),
);

export const followUpStepAnchorValidator = v.union(
  v.object({
    kind: v.literal("previousEnd"),
    offsetMinutes: v.number(),
  }),
  v.object({
    kind: v.literal("rootStart"),
    offsetMinutes: v.number(),
  }),
  v.object({
    kind: v.literal("rootEnd"),
    offsetMinutes: v.number(),
  }),
  v.object({
    kind: v.literal("previousDate"),
    offsetDays: v.optional(v.number()),
    offsetMonths: v.optional(v.number()),
    offsetWeeks: v.optional(v.number()),
  }),
);

export const followUpStepValidator = v.object({
  anchor: followUpStepAnchorValidator,
  appointmentTypeLineageKey: v.id("appointmentTypes"),
  locationMode: followUpLocationModeValidator,
  note: v.optional(v.string()),
  practitionerMode: followUpPractitionerModeValidator,
  required: v.boolean(),
  searchMode: followUpSearchModeValidator,
  stepId: v.string(),
});

export const followUpPlanVariantValidator = v.object({
  steps: v.array(followUpStepValidator),
  title: v.string(),
  variantId: v.string(),
});

export const followUpPlanVariantsValidator = v.optional(
  v.array(followUpPlanVariantValidator),
);

export interface FollowUpPlanVariant extends Omit<
  RawFollowUpPlanVariant,
  "steps"
> {
  steps: FollowUpStep[];
}

export type FollowUpPlanVariants = FollowUpPlanVariant[] | undefined;

export interface FollowUpStep extends Omit<
  RawFollowUpStep,
  "appointmentTypeLineageKey"
> {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
}

type RawFollowUpPlanVariant = Infer<typeof followUpPlanVariantValidator>;
type RawFollowUpPlanVariants = Infer<typeof followUpPlanVariantsValidator>;
type RawFollowUpStep = Infer<typeof followUpStepValidator>;

export async function getAppointmentTypeByLineageKey(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
  lineageKey: AppointmentTypeLineageKey,
): Promise<Doc<"appointmentTypes"> | null> {
  return await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();
}

export function getFollowUpPlanVariant(
  followUpPlanVariants: FollowUpPlanVariants,
  variantId: string,
): FollowUpPlanVariant | undefined {
  return followUpPlanVariants?.find(
    (variant) => variant.variantId === variantId,
  );
}

export function normalizeFollowUpPlanVariants(
  followUpPlanVariants: FollowUpPlanVariants | RawFollowUpPlanVariants,
): FollowUpPlanVariants {
  if (!followUpPlanVariants || followUpPlanVariants.length === 0) {
    return undefined;
  }

  return followUpPlanVariants.map((variant) => ({
    steps: variant.steps.map((step) => ({
      ...step,
      appointmentTypeLineageKey: asAppointmentTypeLineageKey(
        step.appointmentTypeLineageKey,
      ),
      ...(step.note?.trim() ? { note: step.note.trim() } : {}),
      stepId: step.stepId.trim(),
    })),
    title: variant.title.trim(),
    variantId: variant.variantId.trim(),
  }));
}

export async function requireAppointmentTypeByLineageKey(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
  lineageKey: AppointmentTypeLineageKey,
): Promise<Doc<"appointmentTypes">> {
  const appointmentType = await getAppointmentTypeByLineageKey(
    db,
    ruleSetId,
    lineageKey,
  );

  if (!appointmentType) {
    throw buildMissingAppointmentTypeError(lineageKey, ruleSetId);
  }

  return appointmentType;
}

export async function validateFollowUpPlanVariants(
  db: DatabaseReader | DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  followUpPlanVariants: FollowUpPlanVariants | RawFollowUpPlanVariants,
  currentAppointmentTypeLineageKey?: AppointmentTypeLineageKey,
): Promise<FollowUpPlanVariants> {
  const normalizedVariants =
    normalizeFollowUpPlanVariants(followUpPlanVariants);

  if (!normalizedVariants || normalizedVariants.length === 0) {
    return undefined;
  }

  const seenVariantIds = new Set<string>();
  const seenVariantTitles = new Set<string>();

  for (const variant of normalizedVariants) {
    if (variant.variantId.length === 0) {
      throw followUpPlanError(
        "FOLLOW_UP_PLAN_VARIANT:VARIANT_ID_REQUIRED",
        "Jede Kettentermin-Variante benötigt eine Kennung.",
      );
    }

    if (seenVariantIds.has(variant.variantId)) {
      throw followUpPlanError(
        "FOLLOW_UP_PLAN_VARIANT:DUPLICATE_VARIANT_ID",
        `Die Varianten-Kennung "${variant.variantId}" ist mehrfach vergeben.`,
      );
    }
    seenVariantIds.add(variant.variantId);

    if (variant.title.length === 0) {
      throw followUpPlanError(
        "FOLLOW_UP_PLAN_VARIANT:TITLE_REQUIRED",
        "Jede Kettentermin-Variante benötigt einen Titel.",
      );
    }

    if (seenVariantTitles.has(variant.title)) {
      throw followUpPlanError(
        "FOLLOW_UP_PLAN_VARIANT:DUPLICATE_TITLE",
        `Der Varianten-Titel "${variant.title}" ist mehrfach vergeben.`,
      );
    }
    seenVariantTitles.add(variant.title);

    const seenStepIds = new Set<string>();
    for (const step of variant.steps) {
      const stepId = step.stepId.trim();
      if (stepId.length === 0) {
        throw followUpPlanError(
          "FOLLOW_UP_PLAN:STEP_ID_REQUIRED",
          `Jeder Kettentermin-Schritt in Variante "${variant.title}" benötigt eine Kennung.`,
        );
      }

      if (seenStepIds.has(stepId)) {
        throw followUpPlanError(
          "FOLLOW_UP_PLAN:DUPLICATE_STEP_ID",
          `Die Schritt-ID "${stepId}" ist in Variante "${variant.title}" mehrfach vergeben.`,
        );
      }
      seenStepIds.add(stepId);

      validateFollowUpAnchor(step, stepId, variant.title);
      validateFollowUpModes(step, stepId, variant.title);

      if (
        currentAppointmentTypeLineageKey &&
        step.appointmentTypeLineageKey === currentAppointmentTypeLineageKey
      ) {
        throw followUpPlanError(
          "FOLLOW_UP_PLAN:SELF_REFERENCE",
          `Terminart ${currentAppointmentTypeLineageKey} darf sich nicht selbst als Folgetermin referenzieren.`,
        );
      }

      await requireAppointmentTypeByLineageKey(
        db,
        ruleSetId,
        step.appointmentTypeLineageKey,
      );
    }
  }

  return normalizedVariants;
}

function buildMissingAppointmentTypeError(
  lineageKey: AppointmentTypeLineageKey,
  ruleSetId: Id<"ruleSets">,
): Error {
  return followUpPlanError(
    "FOLLOW_UP_PLAN:APPOINTMENT_TYPE_NOT_FOUND",
    `Terminart mit lineageKey ${lineageKey} wurde im Regelset ${ruleSetId} nicht gefunden.`,
  );
}

function countDefinedOffsets(
  anchor: Extract<FollowUpStep["anchor"], { kind: "previousDate" }>,
) {
  return [anchor.offsetDays, anchor.offsetWeeks, anchor.offsetMonths].filter(
    (value) => value !== undefined,
  ).length;
}

function followUpPlanError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function validateFollowUpAnchor(
  step: FollowUpStep,
  stepId: string,
  variantTitle: string,
) {
  if (step.anchor.kind === "previousDate") {
    if (countDefinedOffsets(step.anchor) !== 1) {
      throw followUpPlanError(
        "FOLLOW_UP_PLAN:INVALID_PREVIOUS_DATE_OFFSET",
        `Schritt "${stepId}" in Variante "${variantTitle}" muss genau einen Tages-, Wochen- oder Monatsversatz angeben.`,
      );
    }

    const offsetValue =
      step.anchor.offsetDays ??
      step.anchor.offsetWeeks ??
      step.anchor.offsetMonths;

    if (
      offsetValue === undefined ||
      !Number.isInteger(offsetValue) ||
      offsetValue < 1
    ) {
      throw followUpPlanError(
        "FOLLOW_UP_PLAN:INVALID_OFFSET",
        `Schritt "${stepId}" in Variante "${variantTitle}" benötigt für Datumsversätze eine positive ganze Zahl.`,
      );
    }

    return;
  }

  if (
    !Number.isInteger(step.anchor.offsetMinutes) ||
    step.anchor.offsetMinutes < 0
  ) {
    throw followUpPlanError(
      "FOLLOW_UP_PLAN:INVALID_OFFSET",
      `Schritt "${stepId}" in Variante "${variantTitle}" benötigt einen nicht-negativen Minutenversatz.`,
    );
  }

  if (step.anchor.offsetMinutes % 5 !== 0) {
    throw followUpPlanError(
      "FOLLOW_UP_PLAN:INVALID_OFFSET_STEP",
      `Schritt "${stepId}" in Variante "${variantTitle}" muss Minutenversätze in 5er-Schritten angeben.`,
    );
  }
}

function validateFollowUpModes(
  step: FollowUpStep,
  stepId: string,
  variantTitle: string,
) {
  if (
    step.practitionerMode === "inherit_previous" &&
    (step.anchor.kind === "rootStart" || step.anchor.kind === "rootEnd")
  ) {
    throw followUpPlanError(
      "FOLLOW_UP_PLAN:INVALID_PRACTITIONER_MODE",
      `Schritt "${stepId}" in Variante "${variantTitle}" kann beim Root-Anker keinen vorherigen Behandler übernehmen.`,
    );
  }

  if (
    step.locationMode === "inherit_previous" &&
    (step.anchor.kind === "rootStart" || step.anchor.kind === "rootEnd")
  ) {
    throw followUpPlanError(
      "FOLLOW_UP_PLAN:INVALID_LOCATION_MODE",
      `Schritt "${stepId}" in Variante "${variantTitle}" kann beim Root-Anker keinen vorherigen Standort übernehmen.`,
    );
  }
}

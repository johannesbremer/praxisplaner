import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { Infer } from "convex/values";

import { v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export const followUpOffsetUnitValidator = v.union(
  v.literal("minutes"),
  v.literal("days"),
  v.literal("weeks"),
  v.literal("months"),
);

export const followUpSearchModeValidator = v.union(
  v.literal("exact_after_previous"),
  v.literal("same_day"),
  v.literal("first_available_on_or_after"),
);

export const followUpPractitionerModeValidator = v.union(
  v.literal("inherit"),
  v.literal("reselect"),
);

export const followUpLocationModeValidator = v.union(
  v.literal("inherit"),
  v.literal("reselect"),
);

export const followUpStepValidator = v.object({
  appointmentTypeLineageKey: v.id("appointmentTypes"),
  locationMode: followUpLocationModeValidator,
  note: v.optional(v.string()),
  offsetUnit: followUpOffsetUnitValidator,
  offsetValue: v.number(),
  practitionerMode: followUpPractitionerModeValidator,
  required: v.boolean(),
  searchMode: followUpSearchModeValidator,
  stepId: v.string(),
});

export const followUpPlanValidator = v.optional(v.array(followUpStepValidator));

export type FollowUpPlan = Infer<typeof followUpPlanValidator>;
export type FollowUpStep = Infer<typeof followUpStepValidator>;

export async function getAppointmentTypeByLineageKey(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
  lineageKey: Id<"appointmentTypes">,
): Promise<Doc<"appointmentTypes"> | null> {
  return await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();
}

export function normalizeFollowUpPlan(
  followUpPlan: FollowUpPlan,
): FollowUpPlan | undefined {
  if (!followUpPlan || followUpPlan.length === 0) {
    return undefined;
  }

  return followUpPlan.map((step) => ({
    ...step,
    ...(step.note?.trim() ? { note: step.note.trim() } : {}),
    offsetValue: Math.trunc(step.offsetValue),
    required: step.required,
  }));
}

export async function requireAppointmentTypeByLineageKey(
  db: DatabaseReader,
  ruleSetId: Id<"ruleSets">,
  lineageKey: Id<"appointmentTypes">,
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

export async function validateFollowUpPlan(
  db: DatabaseReader | DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  followUpPlan: FollowUpPlan,
  currentAppointmentTypeLineageKey?: Id<"appointmentTypes">,
): Promise<FollowUpPlan | undefined> {
  const normalizedPlan = normalizeFollowUpPlan(followUpPlan);

  if (!normalizedPlan || normalizedPlan.length === 0) {
    return undefined;
  }

  const seenStepIds = new Set<string>();
  for (const step of normalizedPlan) {
    const trimmedStepId = step.stepId.trim();
    if (trimmedStepId.length === 0) {
      throw new Error(
        "[FOLLOW_UP_PLAN:STEP_ID_REQUIRED] Jeder Kettentermin-Schritt benötigt eine Kennung.",
      );
    }

    if (seenStepIds.has(trimmedStepId)) {
      throw new Error(
        `[FOLLOW_UP_PLAN:DUPLICATE_STEP_ID] Die Schritt-ID "${trimmedStepId}" ist mehrfach vergeben.`,
      );
    }
    seenStepIds.add(trimmedStepId);

    if (!Number.isInteger(step.offsetValue) || step.offsetValue < 0) {
      throw new Error(
        `[FOLLOW_UP_PLAN:INVALID_OFFSET] Der Offset für Schritt "${trimmedStepId}" muss eine ganze Zahl ab 0 sein.`,
      );
    }

    if (
      currentAppointmentTypeLineageKey &&
      step.appointmentTypeLineageKey === currentAppointmentTypeLineageKey
    ) {
      throw new Error(
        `[FOLLOW_UP_PLAN:SELF_REFERENCE] Terminart ${currentAppointmentTypeLineageKey} darf sich nicht selbst als Folgetermin referenzieren.`,
      );
    }

    await requireAppointmentTypeByLineageKey(
      db,
      ruleSetId,
      step.appointmentTypeLineageKey,
    );
  }

  return normalizedPlan.map((step) => ({
    ...step,
    stepId: step.stepId.trim(),
  }));
}

function buildMissingAppointmentTypeError(
  lineageKey: Id<"appointmentTypes">,
  ruleSetId: Id<"ruleSets">,
): Error {
  return new Error(
    `[FOLLOW_UP_PLAN:APPOINTMENT_TYPE_NOT_FOUND] Terminart mit lineageKey ${lineageKey} wurde im Regelset ${ruleSetId} nicht gefunden.`,
  );
}

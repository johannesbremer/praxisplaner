import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { Infer } from "convex/values";

import { ConvexError, v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  PractitionerLineageKey,
} from "./identity";

import { calendarResourceColumnValidator } from "./appointmentOccupancy";
import {
  asAppointmentTypeLineageKey,
  asPractitionerLineageKey,
} from "./identity";

type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export const appointmentTypeBookableViaOptionValidator = v.union(
  v.literal("staff"),
  v.literal("online"),
  v.literal("telefonki"),
  v.literal("planStep"),
);

export const appointmentTypeBookableViaValidator = v.array(
  appointmentTypeBookableViaOptionValidator,
);

export const appointmentTypeDefaultOccupancyValidator = v.union(
  v.object({
    kind: v.literal("selectedPractitioner"),
  }),
  v.object({
    kind: v.literal("specificPractitioner"),
    practitionerLineageKey: v.id("practitioners"),
  }),
  v.object({
    calendarResourceColumn: calendarResourceColumnValidator,
    kind: v.literal("resourceColumn"),
  }),
);

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

export const appointmentPlanTimingValidator = v.union(
  v.object({
    kind: v.literal("afterPreviousEnd"),
    offsetMinutes: v.number(),
  }),
  v.object({
    kind: v.literal("beforeRootStart"),
    offsetMinutes: v.number(),
  }),
  v.object({
    anchorStepId: v.string(),
    kind: v.literal("sameStartAs"),
  }),
  v.object({
    anchorStepId: v.string(),
    kind: v.literal("firstAvailableOnOrAfter"),
    offsetUnit: v.union(
      v.literal("days"),
      v.literal("weeks"),
      v.literal("months"),
    ),
    offsetValue: v.number(),
  }),
);

export const appointmentPlanOccupancyValidator = v.union(
  v.object({
    kind: v.literal("inheritRootPractitioner"),
  }),
  v.object({
    kind: v.literal("specificPractitioner"),
    practitionerLineageKey: v.id("practitioners"),
  }),
  v.object({
    calendarResourceColumn: calendarResourceColumnValidator,
    kind: v.literal("resourceColumn"),
  }),
);

export const appointmentPlanStepValidator = v.object({
  appointmentTypeLineageKey: v.id("appointmentTypes"),
  note: v.optional(v.string()),
  occupancy: appointmentPlanOccupancyValidator,
  required: v.boolean(),
  stepId: v.string(),
  timing: appointmentPlanTimingValidator,
});

export const appointmentPlanValidator = v.optional(
  v.object({
    steps: v.array(appointmentPlanStepValidator),
  }),
);

export type AppointmentPlan = undefined | { steps: AppointmentPlanStep[] };
export type AppointmentPlanBookableVia = Infer<
  typeof appointmentTypeBookableViaValidator
>;
export type AppointmentPlanBookableViaOption = Infer<
  typeof appointmentTypeBookableViaOptionValidator
>;
export type AppointmentPlanOccupancy = Infer<
  typeof appointmentPlanOccupancyValidator
>;
export interface AppointmentPlanStep extends Omit<
  RawAppointmentPlanStep,
  "appointmentTypeLineageKey"
> {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
}
export type AppointmentPlanTiming = Infer<
  typeof appointmentPlanTimingValidator
>;
export type AppointmentTypeDefaultOccupancy = Infer<
  typeof appointmentTypeDefaultOccupancyValidator
>;

export type FollowUpPlan = FollowUpStep[] | undefined;
export interface FollowUpStep extends Omit<
  RawFollowUpStep,
  "appointmentTypeLineageKey"
> {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
}
type RawAppointmentPlan = Infer<typeof appointmentPlanValidator>;

type RawAppointmentPlanStep = Infer<typeof appointmentPlanStepValidator>;
type RawFollowUpPlan = Infer<typeof followUpPlanValidator>;

type RawFollowUpStep = Infer<typeof followUpStepValidator>;

const DEFAULT_BOOKABLE_VIA: AppointmentPlanBookableVia = [
  "staff",
  "online",
  "telefonki",
  "planStep",
];

export function followUpPlanToAppointmentPlan(
  followUpPlan: FollowUpPlan | RawFollowUpPlan,
): AppointmentPlan | undefined {
  const normalizedFollowUpPlan = normalizeFollowUpPlan(followUpPlan);
  if (!normalizedFollowUpPlan || normalizedFollowUpPlan.length === 0) {
    return undefined;
  }

  return {
    steps: normalizedFollowUpPlan.map((step, index) => ({
      appointmentTypeLineageKey: step.appointmentTypeLineageKey,
      ...(step.note ? { note: step.note } : {}),
      occupancy: { kind: "inheritRootPractitioner" },
      required: step.required,
      stepId: step.stepId || `step-${index + 1}`,
      timing:
        step.offsetUnit === "minutes"
          ? {
              kind: "afterPreviousEnd",
              offsetMinutes: step.offsetValue,
            }
          : {
              anchorStepId: getPreviousFollowUpStepId(
                normalizedFollowUpPlan,
                index,
              ),
              kind: "firstAvailableOnOrAfter",
              offsetUnit: step.offsetUnit,
              offsetValue: step.offsetValue,
            },
    })),
  };
}

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

export function hasAppointmentPlan(
  appointmentType: Pick<
    Doc<"appointmentTypes">,
    "appointmentPlan" | "followUpPlan"
  >,
): boolean {
  return (
    (appointmentType.appointmentPlan?.steps.length ?? 0) > 0 ||
    (appointmentType.followUpPlan?.length ?? 0) > 0
  );
}

export function normalizeAppointmentPlan(
  appointmentPlan: AppointmentPlan | RawAppointmentPlan,
): AppointmentPlan | undefined {
  if (!appointmentPlan || appointmentPlan.steps.length === 0) {
    return undefined;
  }

  return {
    steps: appointmentPlan.steps.map((step) => ({
      ...step,
      appointmentTypeLineageKey: asAppointmentTypeLineageKey(
        step.appointmentTypeLineageKey,
      ),
      ...(step.note?.trim() ? { note: step.note.trim() } : {}),
      required: step.required,
      stepId: step.stepId.trim(),
    })),
  };
}

export function normalizeBookableVia(
  bookableVia?: AppointmentPlanBookableVia,
): AppointmentPlanBookableVia {
  if (!bookableVia || bookableVia.length === 0) {
    return DEFAULT_BOOKABLE_VIA;
  }

  return [...new Set(bookableVia)];
}

export function normalizeDefaultOccupancy(
  defaultOccupancy: AppointmentTypeDefaultOccupancy | undefined,
): AppointmentTypeDefaultOccupancy {
  return defaultOccupancy ?? { kind: "selectedPractitioner" };
}

export function normalizeFollowUpPlan(
  followUpPlan: FollowUpPlan | RawFollowUpPlan,
): FollowUpPlan | undefined {
  if (!followUpPlan || followUpPlan.length === 0) {
    return undefined;
  }

  return followUpPlan.map((step) => ({
    ...step,
    appointmentTypeLineageKey: asAppointmentTypeLineageKey(
      step.appointmentTypeLineageKey,
    ),
    ...(step.note?.trim() ? { note: step.note.trim() } : {}),
    required: step.required,
    stepId: step.stepId.trim(),
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

export async function validateAppointmentPlan(
  db: DatabaseReader | DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  appointmentPlan: AppointmentPlan | RawAppointmentPlan,
  currentAppointmentTypeLineageKey?: AppointmentTypeLineageKey,
): Promise<AppointmentPlan | undefined> {
  const normalizedPlan = normalizeAppointmentPlan(appointmentPlan);

  if (!normalizedPlan || normalizedPlan.steps.length === 0) {
    return undefined;
  }

  const seenStepIds = new Set<string>();
  for (const step of normalizedPlan.steps) {
    validateStepId(step, seenStepIds);
    validateRequiredStep(step);
    validateTiming(step, seenStepIds);

    if (
      currentAppointmentTypeLineageKey &&
      step.appointmentTypeLineageKey === currentAppointmentTypeLineageKey
    ) {
      throw appointmentPlanError(
        "APPOINTMENT_PLAN:SELF_REFERENCE",
        `Terminart ${currentAppointmentTypeLineageKey} darf sich nicht selbst als Kettentermin referenzieren.`,
      );
    }

    await requireAppointmentTypeByLineageKey(
      db,
      ruleSetId,
      step.appointmentTypeLineageKey,
    );
    await validateSpecificPractitionerOccupancy(db, ruleSetId, step.occupancy);
  }

  return normalizedPlan;
}

export async function validateDefaultOccupancy(
  db: DatabaseReader | DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  defaultOccupancy: AppointmentTypeDefaultOccupancy | undefined,
): Promise<AppointmentTypeDefaultOccupancy> {
  const normalized = normalizeDefaultOccupancy(defaultOccupancy);
  if (normalized.kind === "specificPractitioner") {
    await requirePractitionerLineageKeyInRuleSet(
      db,
      ruleSetId,
      asPractitionerLineageKey(normalized.practitionerLineageKey),
    );
  }
  return normalized;
}

function appointmentPlanError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function buildMissingAppointmentTypeError(
  lineageKey: AppointmentTypeLineageKey,
  ruleSetId: Id<"ruleSets">,
): Error {
  return appointmentPlanError(
    "FOLLOW_UP_PLAN:APPOINTMENT_TYPE_NOT_FOUND",
    `Terminart mit lineageKey ${lineageKey} wurde im Regelset ${ruleSetId} nicht gefunden.`,
  );
}

function getPreviousFollowUpStepId(
  followUpPlan: FollowUpStep[],
  index: number,
): string {
  if (index === 0) {
    return "root";
  }

  const previousStep = followUpPlan[index - 1];
  if (!previousStep) {
    throw appointmentPlanError(
      "APPOINTMENT_PLAN:INVALID_LEGACY_ANCHOR",
      "Legacy-Kettentermin konnte keinen vorherigen Schritt bestimmen.",
    );
  }

  return previousStep.stepId;
}

async function requirePractitionerLineageKeyInRuleSet(
  db: DatabaseReader | DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  lineageKey: PractitionerLineageKey,
) {
  const practitioner = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("lineageKey", lineageKey),
    )
    .first();

  if (!practitioner || practitioner.deleted === true) {
    throw appointmentPlanError(
      "APPOINTMENT_PLAN:PRACTITIONER_NOT_FOUND",
      `Behandler mit lineageKey ${lineageKey} wurde im Regelset ${ruleSetId} nicht gefunden.`,
    );
  }
}

function validateAnchorStepId(
  stepId: string,
  anchorStepId: string,
  previousStepIds: ReadonlySet<string>,
) {
  if (anchorStepId === "root" || previousStepIds.has(anchorStepId)) {
    if (anchorStepId === stepId) {
      throw appointmentPlanError(
        "APPOINTMENT_PLAN:INVALID_ANCHOR",
        `Schritt "${stepId}" darf nicht auf sich selbst verweisen.`,
      );
    }
    return;
  }

  throw appointmentPlanError(
    "APPOINTMENT_PLAN:INVALID_ANCHOR",
    `Schritt "${stepId}" verweist auf einen unbekannten oder späteren Anker "${anchorStepId}".`,
  );
}

function validateIntegerMinutes(value: number, stepId: string) {
  if (!Number.isInteger(value)) {
    throw appointmentPlanError(
      "FOLLOW_UP_PLAN:INVALID_OFFSET",
      `Der Minutenversatz für Schritt "${stepId}" muss eine ganze Zahl sein.`,
    );
  }

  if (value < 0) {
    throw appointmentPlanError(
      "FOLLOW_UP_PLAN:INVALID_OFFSET",
      `Der Minutenversatz für Schritt "${stepId}" muss nicht-negativ sein.`,
    );
  }

  if (value % 5 !== 0) {
    throw appointmentPlanError(
      "FOLLOW_UP_PLAN:INVALID_OFFSET_STEP",
      `Der Minutenversatz für Schritt "${stepId}" muss in 5er-Schritten angegeben werden.`,
    );
  }
}

function validateRequiredStep(step: AppointmentPlanStep) {
  if (!step.required) {
    throw appointmentPlanError(
      "APPOINTMENT_PLAN:OPTIONAL_STEPS_UNSUPPORTED",
      `Schritt "${step.stepId}" muss im MVP als erforderlich markiert sein.`,
    );
  }
}

async function validateSpecificPractitionerOccupancy(
  db: DatabaseReader | DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  occupancy: AppointmentPlanOccupancy,
) {
  if (occupancy.kind !== "specificPractitioner") {
    return;
  }

  await requirePractitionerLineageKeyInRuleSet(
    db,
    ruleSetId,
    asPractitionerLineageKey(occupancy.practitionerLineageKey),
  );
}

function validateStepId(step: AppointmentPlanStep, seenStepIds: Set<string>) {
  const trimmedStepId = step.stepId.trim();
  if (trimmedStepId.length === 0) {
    throw appointmentPlanError(
      "APPOINTMENT_PLAN:STEP_ID_REQUIRED",
      "Jeder Kettentermin-Schritt benötigt eine Kennung.",
    );
  }

  if (trimmedStepId === "root") {
    throw appointmentPlanError(
      "APPOINTMENT_PLAN:ROOT_STEP_ID_RESERVED",
      'Die Schritt-ID "root" ist für den Starttermin reserviert.',
    );
  }

  if (seenStepIds.has(trimmedStepId)) {
    throw appointmentPlanError(
      "APPOINTMENT_PLAN:DUPLICATE_STEP_ID",
      `Die Schritt-ID "${trimmedStepId}" ist mehrfach vergeben.`,
    );
  }
  seenStepIds.add(trimmedStepId);
}

function validateTiming(
  step: AppointmentPlanStep,
  previousStepIds: ReadonlySet<string>,
) {
  switch (step.timing.kind) {
    case "afterPreviousEnd":
    case "beforeRootStart": {
      validateIntegerMinutes(step.timing.offsetMinutes, step.stepId);
      return;
    }
    case "firstAvailableOnOrAfter": {
      validateAnchorStepId(
        step.stepId,
        step.timing.anchorStepId,
        previousStepIds,
      );
      if (
        !Number.isInteger(step.timing.offsetValue) ||
        step.timing.offsetValue < 1
      ) {
        throw appointmentPlanError(
          "FOLLOW_UP_PLAN:INVALID_OFFSET",
          `Der Datumsversatz für Schritt "${step.stepId}" muss mindestens 1 sein.`,
        );
      }
      return;
    }
    case "sameStartAs": {
      validateAnchorStepId(
        step.stepId,
        step.timing.anchorStepId,
        previousStepIds,
      );
      return;
    }
  }
}

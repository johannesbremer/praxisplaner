import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { Infer } from "convex/values";

import { ConvexError, v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { AppointmentTypeLineageKey } from "./identity";

import { calendarResourceColumnValidator } from "./appointmentOccupancy";
import { asAppointmentTypeLineageKey } from "./identity";

type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export const appointmentTypeDefaultOccupancyValidator = v.union(
  v.object({
    kind: v.literal("selectedPractitioner"),
  }),
  v.object({
    calendarResourceColumn: calendarResourceColumnValidator,
    kind: v.literal("resourceColumn"),
  }),
);

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
type RawAppointmentPlan = Infer<typeof appointmentPlanValidator>;

type RawAppointmentPlanStep = Infer<typeof appointmentPlanStepValidator>;

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
  appointmentType: Pick<Doc<"appointmentTypes">, "appointmentPlan">,
): boolean {
  return (appointmentType.appointmentPlan?.steps.length ?? 0) > 0;
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

export function normalizeDefaultOccupancy(
  defaultOccupancy: AppointmentTypeDefaultOccupancy | undefined,
): AppointmentTypeDefaultOccupancy {
  return defaultOccupancy ?? { kind: "selectedPractitioner" };
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
  }

  return normalizedPlan;
}

export function validateDefaultOccupancy(
  defaultOccupancy: AppointmentTypeDefaultOccupancy | undefined,
): AppointmentTypeDefaultOccupancy {
  return normalizeDefaultOccupancy(defaultOccupancy);
}

function appointmentPlanError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function buildMissingAppointmentTypeError(
  lineageKey: AppointmentTypeLineageKey,
  ruleSetId: Id<"ruleSets">,
): Error {
  return appointmentPlanError(
    "APPOINTMENT_PLAN:APPOINTMENT_TYPE_NOT_FOUND",
    `Terminart mit lineageKey ${lineageKey} wurde im Regelset ${ruleSetId} nicht gefunden.`,
  );
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
      "APPOINTMENT_PLAN:INVALID_OFFSET",
      `Der Minutenversatz für Schritt "${stepId}" muss eine ganze Zahl sein.`,
    );
  }

  if (value < 0) {
    throw appointmentPlanError(
      "APPOINTMENT_PLAN:INVALID_OFFSET",
      `Der Minutenversatz für Schritt "${stepId}" muss nicht-negativ sein.`,
    );
  }

  if (value % 5 !== 0) {
    throw appointmentPlanError(
      "APPOINTMENT_PLAN:INVALID_OFFSET_STEP",
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
          "APPOINTMENT_PLAN:INVALID_OFFSET",
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

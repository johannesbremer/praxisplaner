import { v } from "convex/values";

import { followUpStepValidator } from "./followUpPlans";
import { conditionTreeNodeValidator } from "./ruleEngine";

export const appointmentTypeResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("appointmentTypes"),
  ruleSetId: v.id("ruleSets"),
});

export const practitionerResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("practitioners"),
  ruleSetId: v.id("ruleSets"),
});

export const locationResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("locations"),
  ruleSetId: v.id("ruleSets"),
});

export const baseScheduleResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("baseSchedules"),
  ruleSetId: v.id("ruleSets"),
});

export const baseScheduleBatchResultValidator = v.object({
  createdScheduleIds: v.array(v.id("baseSchedules")),
  draftRevision: v.number(),
  ruleSetId: v.id("ruleSets"),
});

export const ruleResultValidator = v.object({
  draftRevision: v.number(),
  entityId: v.id("ruleConditions"),
  ruleSetId: v.id("ruleSets"),
});

export const baseSchedulePayloadValidator = v.object({
  breakTimes: v.optional(
    v.array(
      v.object({
        end: v.string(),
        start: v.string(),
      }),
    ),
  ),
  dayOfWeek: v.number(),
  endTime: v.string(),
  lineageKey: v.id("baseSchedules"),
  locationId: v.id("locations"),
  practitionerId: v.id("practitioners"),
  startTime: v.string(),
});

export const baseScheduleCreatePayloadValidator = v.object({
  breakTimes: v.optional(
    v.array(
      v.object({
        end: v.string(),
        start: v.string(),
      }),
    ),
  ),
  dayOfWeek: v.number(),
  endTime: v.string(),
  lineageKey: v.optional(v.id("baseSchedules")),
  locationId: v.id("locations"),
  practitionerId: v.id("practitioners"),
  startTime: v.string(),
});

export const replaceBaseScheduleSetResultValidator = v.object({
  appliedSchedules: v.array(
    v.object({
      breakTimes: v.optional(
        v.array(
          v.object({
            end: v.string(),
            start: v.string(),
          }),
        ),
      ),
      dayOfWeek: v.number(),
      endTime: v.string(),
      entityId: v.id("baseSchedules"),
      lineageKey: v.id("baseSchedules"),
      locationId: v.id("locations"),
      locationLineageKey: v.id("locations"),
      practitionerId: v.id("practitioners"),
      practitionerLineageKey: v.id("practitioners"),
      startTime: v.string(),
    }),
  ),
  createdScheduleIds: v.array(v.id("baseSchedules")),
  deletedScheduleIds: v.array(v.id("baseSchedules")),
  draftRevision: v.number(),
  ruleSetId: v.id("ruleSets"),
});

export const practitionerBaseScheduleSnapshotValidator = v.object({
  breakTimes: v.optional(
    v.array(
      v.object({
        end: v.string(),
        start: v.string(),
      }),
    ),
  ),
  dayOfWeek: v.number(),
  endTime: v.string(),
  lineageKey: v.id("baseSchedules"),
  locationId: v.id("locations"),
  locationLineageKey: v.id("locations"),
  locationOriginId: v.optional(v.id("locations")),
  startTime: v.string(),
});

export const practitionerSnapshotValidator = v.object({
  id: v.id("practitioners"),
  lineageKey: v.id("practitioners"),
  name: v.string(),
  tags: v.optional(v.array(v.string())),
});

export const practitionerAppointmentTypePatchValidator = v.object({
  action: v.union(v.literal("delete"), v.literal("patch")),
  afterAllowedPractitionerIds: v.array(v.id("practitioners")),
  appointmentTypeId: v.id("appointmentTypes"),
  beforeAllowedPractitionerIds: v.array(v.id("practitioners")),
  duration: v.optional(v.number()),
  lineageKey: v.id("appointmentTypes"),
  name: v.optional(v.string()),
});

export const practitionerConditionPatchValidator = v.object({
  afterValueIds: v.array(v.string()),
  beforeValueIds: v.array(v.string()),
  conditionId: v.id("ruleConditions"),
});

export const practitionerDependencySnapshotValidator = v.object({
  appointmentTypePatches: v.array(practitionerAppointmentTypePatchValidator),
  baseSchedules: v.array(practitionerBaseScheduleSnapshotValidator),
  practitioner: practitionerSnapshotValidator,
  practitionerConditionPatches: v.array(practitionerConditionPatchValidator),
});

export const deletePractitionerWithDependenciesResultValidator = v.object({
  draftRevision: v.number(),
  ruleSetId: v.id("ruleSets"),
  snapshot: practitionerDependencySnapshotValidator,
});

export const restorePractitionerWithDependenciesResultValidator = v.object({
  draftRevision: v.number(),
  restoredPractitionerId: v.id("practitioners"),
  ruleSetId: v.id("ruleSets"),
});

export const expectedDraftRevisionValidator = v.union(v.number(), v.null());

export const appointmentTypeArgsValidator = v.object({
  allowedPractitionerIds: v.optional(v.array(v.id("practitioners"))),
  duration: v.number(),
  followUpPlan: v.optional(v.array(followUpStepValidator)),
  name: v.string(),
  practiceId: v.id("practices"),
  ruleSetId: v.optional(v.id("ruleSets")),
});

export const ruleCreateArgsValidator = v.object({
  conditionTree: conditionTreeNodeValidator,
  copyFromId: v.optional(v.id("ruleConditions")),
  enabled: v.optional(v.boolean()),
  expectedDraftRevision: expectedDraftRevisionValidator,
  practiceId: v.id("practices"),
  ruleSetId: v.optional(v.id("ruleSets")),
});

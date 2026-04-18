/**
 * Tests for Copy-on-Write entity reference validation
 */

import { convexTest } from "convex-test";
import { expect } from "vitest";
import { describe, test } from "vitest";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { api } from "../_generated/api";
import { insertSelfLineageEntity } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";
import { assertDefined } from "./test_utils";

type LineageTable = Extract<
  TableNames,
  "appointmentTypes" | "baseSchedules" | "locations" | "practitioners"
>;

function createAuthedTestContext() {
  return convexTest(schema, modules).withIdentity({
    email: "copyonwrite@example.com",
    subject: "workos_copyonwrite",
  });
}

async function getInitialRuleSetId(
  t: ReturnType<typeof createAuthedTestContext>,
  practiceId: Id<"practices">,
): Promise<Id<"ruleSets">> {
  const practice = await t.run(async (ctx) => {
    const practice = await ctx.db.get("practices", practiceId);
    if (!practice) {
      throw new Error("Practice not found");
    }
    return practice;
  });

  if (!practice.currentActiveRuleSetId) {
    throw new Error("Practice has no active rule set");
  }

  return practice.currentActiveRuleSetId;
}

async function insertWithLineage<TableName extends LineageTable>(
  ctx: MutationCtx,
  table: TableName,
  value: Omit<Doc<TableName>, "_creationTime" | "_id" | "lineageKey">,
  lineageKey?: Id<TableName>,
): Promise<Id<TableName>> {
  return (await insertSelfLineageEntity(
    ctx.db,
    table as never,
    {
      ...value,
      ...(lineageKey ? { lineageKey } : {}),
    } as never,
  )) as Id<TableName>;
}

async function setupBaseScheduleEntities(
  t: ReturnType<typeof createAuthedTestContext>,
): Promise<{
  initialRuleSetId: Id<"ruleSets">;
  locationId: Id<"locations">;
  practiceId: Id<"practices">;
  practitionerId: Id<"practitioners">;
}> {
  const practiceId = await t.mutation(api.practices.createPractice, {
    name: "Test Practice",
  });
  const initialRuleSetId = await getInitialRuleSetId(t, practiceId);

  const practitionerId = await t.run(async (ctx) => {
    return await insertWithLineage(ctx, "practitioners", {
      name: "Dr. Batch",
      practiceId,
      ruleSetId: initialRuleSetId,
    });
  });

  const locationId = await t.run(async (ctx) => {
    return await insertWithLineage(ctx, "locations", {
      name: "Batch Office",
      practiceId,
      ruleSetId: initialRuleSetId,
    });
  });

  return {
    initialRuleSetId,
    locationId,
    practiceId,
    practitionerId,
  };
}

describe("Copy-on-Write Entity Reference Validation", () => {
  test("should remap rule references from older rule sets by lineage", async () => {
    const t = createAuthedTestContext();

    // Create practice (this automatically creates an initial rule set)
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    // Get initial rule set (created by practice setup)
    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice) {
        throw new Error("Practice not found");
      }
      return practice;
    });

    if (!practice.currentActiveRuleSetId) {
      throw new Error("Practice has no active rule set");
    }
    const initialRuleSetId = practice.currentActiveRuleSetId;

    // Create a practitioner first (required for appointment types)
    const practitioner = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Test",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    // Create appointment type in initial rule set
    const appointmentType1 = await t.mutation(
      api.entities.createAppointmentType,
      {
        duration: 30,
        expectedDraftRevision: null,
        name: "Type 1",
        practiceId,
        practitionerIds: [practitioner],
        selectedRuleSetId: initialRuleSetId,
      },
    );

    // Save the rule set
    await t.mutation(api.ruleSets.saveUnsavedRuleSet, {
      description: "Rule set with appointment type",
      practiceId,
      setAsActive: true,
    });

    // Get the saved rule set
    const savedRuleSet1 = await t.run(async (ctx) => {
      const ruleSets = await ctx.db
        .query("ruleSets")
        .withIndex("by_practiceId", (q) => q.eq("practiceId", practiceId))
        .collect();
      return ruleSets.find(
        (rs) => rs.description === "Rule set with appointment type",
      );
    });

    if (!savedRuleSet1) {
      throw new Error("Saved rule set 1 not found");
    }

    // Get the practitioner from savedRuleSet1 (it should have been copied)
    const savedPractitioner = await t.run(async (ctx) => {
      return await ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", savedRuleSet1._id))
        .first();
    });

    if (!savedPractitioner) {
      throw new Error("Saved practitioner not found");
    }

    // Create a second rule set by making a change
    await t.mutation(api.entities.createAppointmentType, {
      duration: 45,
      expectedDraftRevision: null,
      name: "Type 2",
      practiceId,
      practitionerIds: [savedPractitioner._id],
      selectedRuleSetId: savedRuleSet1._id,
    });

    // Get the unsaved rule set (it should have been created automatically)
    const unsavedRuleSet = await t.run(async (ctx) => {
      const ruleSets = await ctx.db
        .query("ruleSets")
        .withIndex("by_practiceId_saved", (q) =>
          q.eq("practiceId", practiceId).eq("saved", false),
        )
        .first();
      return ruleSets;
    });

    if (!unsavedRuleSet) {
      throw new Error("Unsaved rule set not found");
    }

    const result = await t.mutation(api.entities.createRule, {
      conditionTree: {
        children: [
          {
            conditionType: "APPOINTMENT_TYPE",
            nodeType: "CONDITION",
            operator: "IS",
            // Intentionally passing an ID from the older saved rule set.
            // The mutation should remap this by lineage into the active draft.
            valueIds: [appointmentType1.entityId as string],
          },
        ],
        nodeType: "AND",
      },
      expectedDraftRevision: unsavedRuleSet.draftRevision,
      name: "Test Rule",
      practiceId,
      selectedRuleSetId: savedRuleSet1._id,
    });

    expect(result.entityId).toBeDefined();
    expect(result.ruleSetId).toEqual(unsavedRuleSet._id);
  });

  test("should succeed when rule references appointment type from correct rule set", async () => {
    const t = createAuthedTestContext();

    // Create practice (this automatically creates an initial rule set)
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    // Get initial rule set
    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice) {
        throw new Error("Practice not found");
      }
      return practice;
    });

    if (!practice.currentActiveRuleSetId) {
      throw new Error("Practice has no active rule set");
    }
    const initialRuleSetId = practice.currentActiveRuleSetId;

    // Create a practitioner first (required for appointment types)
    const practitioner = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Test",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    // Create appointment type
    const appointmentType = await t.mutation(
      api.entities.createAppointmentType,
      {
        duration: 30,
        expectedDraftRevision: null,
        name: "Correct Type",
        practiceId,
        practitionerIds: [practitioner],
        selectedRuleSetId: initialRuleSetId,
      },
    );

    // Get the unsaved rule set
    const unsavedRuleSet = await t.run(async (ctx) => {
      const ruleSets = await ctx.db
        .query("ruleSets")
        .withIndex("by_practiceId_saved", (q) =>
          q.eq("practiceId", practiceId).eq("saved", false),
        )
        .first();
      return ruleSets;
    });

    if (!unsavedRuleSet) {
      throw new Error("Unsaved rule set not found");
    }

    // Create a rule referencing the appointment type from the SAME rule set
    // This should SUCCEED
    const result = await t.mutation(api.entities.createRule, {
      conditionTree: {
        children: [
          {
            conditionType: "APPOINTMENT_TYPE",
            nodeType: "CONDITION",
            operator: "IS",
            // CORRECT: Using appointment type ID from same rule set
            valueIds: [appointmentType.entityId as string],
          },
        ],
        nodeType: "AND",
      },
      expectedDraftRevision: unsavedRuleSet.draftRevision,
      name: "Test Rule",
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    expect(result.entityId).toBeDefined();
    expect(result.ruleSetId).toEqual(unsavedRuleSet._id);
  });

  test("should correctly remap appointment type IDs when copying rule sets", async () => {
    const t = createAuthedTestContext();

    // Create practice (this automatically creates an initial rule set)
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    // Get initial rule set
    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice) {
        throw new Error("Practice not found");
      }
      return practice;
    });

    if (!practice.currentActiveRuleSetId) {
      throw new Error("Practice has no active rule set");
    }
    const initialRuleSetId = practice.currentActiveRuleSetId;

    // Create a practitioner first (required for appointment types)
    const practitioner = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Test",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    // Create appointment type
    const appointmentType1 = await t.mutation(
      api.entities.createAppointmentType,
      {
        duration: 30,
        expectedDraftRevision: null,
        name: "Type 1",
        practiceId,
        practitionerIds: [practitioner],
        selectedRuleSetId: initialRuleSetId,
      },
    );

    // Get the unsaved rule set
    let unsavedRuleSet = await t.run(async (ctx) => {
      return await ctx.db
        .query("ruleSets")
        .withIndex("by_practiceId_saved", (q) =>
          q.eq("practiceId", practiceId).eq("saved", false),
        )
        .first();
    });

    if (!unsavedRuleSet) {
      throw new Error("Unsaved rule set not found");
    }

    // Create a rule that uses this appointment type
    await t.mutation(api.entities.createRule, {
      conditionTree: {
        children: [
          {
            conditionType: "APPOINTMENT_TYPE",
            nodeType: "CONDITION",
            operator: "IS",
            valueIds: [appointmentType1.entityId as string],
          },
        ],
        nodeType: "AND",
      },
      expectedDraftRevision: unsavedRuleSet.draftRevision,
      name: "Test Rule",
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    // Save the rule set
    await t.mutation(api.ruleSets.saveUnsavedRuleSet, {
      description: "Rule set 1",
      practiceId,
      setAsActive: true,
    });

    // Get the saved rule set
    const savedRuleSet1 = await t.run(async (ctx) => {
      const ruleSets = await ctx.db
        .query("ruleSets")
        .withIndex("by_practiceId", (q) => q.eq("practiceId", practiceId))
        .collect();
      return ruleSets.find((rs) => rs.description === "Rule set 1");
    });

    if (!savedRuleSet1) {
      throw new Error("Saved rule set 1 not found");
    }

    // Get the practitioner from savedRuleSet1 (it should have been copied)
    const savedPractitioner = await t.run(async (ctx) => {
      return await ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", savedRuleSet1._id))
        .first();
    });

    if (!savedPractitioner) {
      throw new Error("Saved practitioner not found");
    }

    // Make a change to trigger copy-on-write (create second rule set)
    await t.mutation(api.entities.createAppointmentType, {
      duration: 45,
      expectedDraftRevision: null,
      name: "Type 2",
      practiceId,
      practitionerIds: [savedPractitioner._id],
      selectedRuleSetId: savedRuleSet1._id,
    });

    // Get the new unsaved rule set
    unsavedRuleSet = await t.run(async (ctx) => {
      return await ctx.db
        .query("ruleSets")
        .withIndex("by_practiceId_saved", (q) =>
          q.eq("practiceId", practiceId).eq("saved", false),
        )
        .first();
    });

    if (!unsavedRuleSet) {
      throw new Error("Unsaved rule set not found after second change");
    }

    // Verify the rule was copied and appointment type IDs were remapped
    const copiedRules = await t.run(async (ctx) => {
      return await ctx.db
        .query("ruleConditions")
        .withIndex("by_ruleSetId_isRoot", (q) =>
          q.eq("ruleSetId", unsavedRuleSet._id).eq("isRoot", true),
        )
        .collect();
    });

    expect(copiedRules).toHaveLength(1);

    // Get the condition nodes that reference appointment types
    const conditionNodes = await t.run(async (ctx) => {
      const allConditions = await ctx.db
        .query("ruleConditions")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", unsavedRuleSet._id))
        .collect();
      return allConditions.filter(
        (c) => c.conditionType === "APPOINTMENT_TYPE" && c.valueIds,
      );
    });

    expect(conditionNodes.length).toBeGreaterThan(0);

    // Verify that the appointment type IDs in the rule now point to
    // appointment types in the NEW rule set, not the old one
    for (const node of conditionNodes) {
      // Filter already ensures valueIds exists, but assert for type safety
      assertDefined(node.valueIds, "valueIds should be defined by filter");
      for (const id of node.valueIds) {
        const appointmentType = await t.run(async (ctx) => {
          return await ctx.db.get(
            "appointmentTypes",
            id as Id<"appointmentTypes">,
          );
        });

        assertDefined(appointmentType, `Appointment type ${id} should exist`);
        // This is the key assertion - the referenced entity belongs to the same rule set
        expect(appointmentType.ruleSetId).toEqual(unsavedRuleSet._id);
      }
    }
  });

  test("should correctly handle CONCURRENT_COUNT conditions with appointment type IDs", async () => {
    const t = createAuthedTestContext();

    // Create practice (this automatically creates an initial rule set)
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    // Get initial rule set
    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice) {
        throw new Error("Practice not found");
      }
      return practice;
    });

    if (!practice.currentActiveRuleSetId) {
      throw new Error("Practice has no active rule set");
    }
    const initialRuleSetId = practice.currentActiveRuleSetId;

    // Create a practitioner first (required for appointment types)
    const practitioner = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Test",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    // Create appointment type
    const appointmentType = await t.mutation(
      api.entities.createAppointmentType,
      {
        duration: 30,
        expectedDraftRevision: null,
        name: "Surgery",
        practiceId,
        practitionerIds: [practitioner],
        selectedRuleSetId: initialRuleSetId,
      },
    );

    // Get the unsaved rule set
    const unsavedRuleSet = await t.run(async (ctx) => {
      return await ctx.db
        .query("ruleSets")
        .withIndex("by_practiceId_saved", (q) =>
          q.eq("practiceId", practiceId).eq("saved", false),
        )
        .first();
    });

    if (!unsavedRuleSet) {
      throw new Error("Unsaved rule set not found");
    }

    // Create a CONCURRENT_COUNT rule
    // scope is now a separate field, valueIds contains only appointment type IDs
    const result = await t.mutation(api.entities.createRule, {
      conditionTree: {
        children: [
          {
            conditionType: "CONCURRENT_COUNT",
            nodeType: "CONDITION",
            operator: "GREATER_THAN_OR_EQUAL",
            scope: "practice",
            valueIds: [appointmentType.entityId as string],
            valueNumber: 2,
          },
        ],
        nodeType: "AND",
      },
      expectedDraftRevision: unsavedRuleSet.draftRevision,
      name: "Concurrent Test Rule",
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    expect(result.entityId).toBeDefined();
    expect(result.ruleSetId).toEqual(unsavedRuleSet._id);

    // Verify the rule was created with the correct structure
    const ruleConditions = await t.run(async (ctx) => {
      return await ctx.db
        .query("ruleConditions")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", unsavedRuleSet._id))
        .collect();
    });

    const concurrentCondition = ruleConditions.find(
      (c) => c.conditionType === "CONCURRENT_COUNT",
    );
    expect(concurrentCondition).toBeDefined();
    if (!concurrentCondition) {
      throw new Error("Concurrent condition not found");
    }
    // scope is now a separate field
    expect(concurrentCondition.scope).toEqual("practice");
    // valueIds only contains appointment type IDs
    expect(concurrentCondition.valueIds).toEqual([appointmentType.entityId]);
  });

  test("should reject legacy rule payloads that rely on implicit scope or DAY_OF_WEEK valueIds", async () => {
    const t = createAuthedTestContext();

    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Strict Rule Payload Practice",
    });

    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice) {
        throw new Error("Practice not found");
      }
      return practice;
    });

    if (!practice.currentActiveRuleSetId) {
      throw new Error("Practice has no active rule set");
    }

    await expect(
      t.mutation(api.entities.createRule, {
        conditionTree: {
          children: [
            {
              conditionType: "CONCURRENT_COUNT",
              nodeType: "CONDITION",
              operator: "GREATER_THAN_OR_EQUAL",
              valueIds: [],
              valueNumber: 1,
            },
            {
              conditionType: "DAY_OF_WEEK",
              nodeType: "CONDITION",
              operator: "IS",
              valueIds: ["MONDAY"],
            },
          ],
          nodeType: "AND",
        },
        expectedDraftRevision: null,
        name: "Legacy Rule Payload",
        practiceId,
        selectedRuleSetId: practice.currentActiveRuleSetId,
      }),
    ).rejects.toThrow(
      "Ungueltiger Regelbaum: Child 0: CONCURRENT_COUNT condition must define scope explicitly; Child 1: DAY_OF_WEEK condition must use valueNumber",
    );
  });

  test("should delete base schedules after a discarded draft when expected revision is reset", async () => {
    const t = createAuthedTestContext();

    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice) {
        throw new Error("Practice not found");
      }
      return practice;
    });

    if (!practice.currentActiveRuleSetId) {
      throw new Error("Practice has no active rule set");
    }
    const initialRuleSetId = practice.currentActiveRuleSetId;

    const practitionerId = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Base Schedule",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    const locationId = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "locations", {
        name: "Main Office",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    const baseScheduleId = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "baseSchedules", {
        dayOfWeek: 1,
        endTime: "12:00",
        locationId,
        practiceId,
        practitionerId,
        ruleSetId: initialRuleSetId,
        startTime: "08:00",
      });
    });

    const firstDelete = await t.mutation(api.entities.deleteBaseSchedule, {
      baseScheduleId,
      expectedDraftRevision: null,
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });
    const discardedDraftRuleSetId = firstDelete.ruleSetId;

    await t.mutation(api.entities.createBaseScheduleBatch, {
      expectedDraftRevision: firstDelete.draftRevision,
      practiceId,
      schedules: [
        {
          dayOfWeek: 1,
          endTime: "12:00",
          locationId,
          practitionerId,
          startTime: "08:00",
        },
      ],
      selectedRuleSetId: initialRuleSetId,
    });

    await t.mutation(api.ruleSets.deleteUnsavedRuleSet, {
      practiceId,
      ruleSetId: discardedDraftRuleSetId,
    });

    const secondDelete = await t.mutation(api.entities.deleteBaseSchedule, {
      baseScheduleId,
      expectedDraftRevision: null,
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    expect(secondDelete.ruleSetId).not.toEqual(discardedDraftRuleSetId);

    const recreatedDraft = await t.run(async (ctx) => {
      return await ctx.db.get("ruleSets", secondDelete.ruleSetId);
    });

    assertDefined(recreatedDraft, "Expected recreated draft rule set");
    expect(recreatedDraft.parentVersion).toEqual(initialRuleSetId);

    const remainingSchedule = await t.run(async (ctx) => {
      return await ctx.db
        .query("baseSchedules")
        .withIndex("by_ruleSetId", (q) =>
          q.eq("ruleSetId", secondDelete.ruleSetId),
        )
        .first();
    });
    expect(remainingSchedule).toBeNull();
  });

  test("should reject empty base schedule batches without creating a draft", async () => {
    const t = createAuthedTestContext();
    const { initialRuleSetId, practiceId } = await setupBaseScheduleEntities(t);

    await expect(
      t.mutation(api.entities.createBaseScheduleBatch, {
        expectedDraftRevision: null,
        practiceId,
        schedules: [],
        selectedRuleSetId: initialRuleSetId,
      }),
    ).rejects.toThrow(/\[VALIDATION:BASE_SCHEDULE_BATCH_EMPTY\]/);

    const unsavedRuleSet = await t.run(async (ctx) => {
      return await ctx.db
        .query("ruleSets")
        .withIndex("by_practiceId_saved", (q) =>
          q.eq("practiceId", practiceId).eq("saved", false),
        )
        .first();
    });

    expect(unsavedRuleSet).toBeNull();
  });

  test("should create batched base schedules in request order and bump draft revision once", async () => {
    const t = createAuthedTestContext();
    const { initialRuleSetId, locationId, practiceId, practitionerId } =
      await setupBaseScheduleEntities(t);

    const created = await t.mutation(api.entities.createBaseScheduleBatch, {
      expectedDraftRevision: null,
      practiceId,
      schedules: [
        {
          dayOfWeek: 1,
          endTime: "12:00",
          locationId,
          practitionerId,
          startTime: "08:00",
        },
        {
          dayOfWeek: 3,
          endTime: "16:00",
          locationId,
          practitionerId,
          startTime: "10:00",
        },
      ],
      selectedRuleSetId: initialRuleSetId,
    });

    expect(created.createdScheduleIds).toHaveLength(2);
    expect(created.draftRevision).toBe(1);
    expect(created.ruleSetId).not.toEqual(initialRuleSetId);

    const draftRuleSet = await t.run(async (ctx) => {
      return await ctx.db.get("ruleSets", created.ruleSetId);
    });
    assertDefined(draftRuleSet, "Expected draft rule set to exist");
    expect(draftRuleSet.saved).toBe(false);
    expect(draftRuleSet.draftRevision).toBe(1);

    const createdSchedules = await t.run(async (ctx) => {
      return await Promise.all(
        created.createdScheduleIds.map(async (scheduleId) => {
          const schedule = await ctx.db.get("baseSchedules", scheduleId);
          if (!schedule) {
            throw new Error(`Base schedule ${scheduleId} not found`);
          }
          return schedule;
        }),
      );
    });

    expect(createdSchedules.map((schedule) => schedule.dayOfWeek)).toEqual([
      1, 3,
    ]);
    expect(createdSchedules.map((schedule) => schedule.startTime)).toEqual([
      "08:00",
      "10:00",
    ]);
  });

  test("should reject duplicate lineage keys within a base schedule batch", async () => {
    const t = createAuthedTestContext();
    const { initialRuleSetId, locationId, practiceId, practitionerId } =
      await setupBaseScheduleEntities(t);

    const firstCreate = await t.mutation(api.entities.createBaseScheduleBatch, {
      expectedDraftRevision: null,
      practiceId,
      schedules: [
        {
          dayOfWeek: 5,
          endTime: "17:00",
          locationId,
          practitionerId,
          startTime: "09:00",
        },
      ],
      selectedRuleSetId: initialRuleSetId,
    });
    const firstCreatedScheduleId = firstCreate.createdScheduleIds[0];
    assertDefined(
      firstCreatedScheduleId,
      "Expected created base schedule id from batch",
    );
    await t.mutation(api.entities.deleteBaseSchedule, {
      baseScheduleId: firstCreatedScheduleId,
      expectedDraftRevision: firstCreate.draftRevision,
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    await expect(
      t.mutation(api.entities.createBaseScheduleBatch, {
        expectedDraftRevision: firstCreate.draftRevision + 1,
        practiceId,
        schedules: [
          {
            dayOfWeek: 1,
            endTime: "12:00",
            lineageKey: firstCreatedScheduleId,
            locationId,
            practitionerId,
            startTime: "08:00",
          },
          {
            dayOfWeek: 2,
            endTime: "13:00",
            lineageKey: firstCreatedScheduleId,
            locationId,
            practitionerId,
            startTime: "09:00",
          },
        ],
        selectedRuleSetId: initialRuleSetId,
      }),
    ).rejects.toThrow(/\[LINEAGE:BASE_SCHEDULE_DUPLICATE_IN_BATCH\]/);
  });

  test("should reject base schedule batch lineage keys that already exist in the draft", async () => {
    const t = createAuthedTestContext();
    const { initialRuleSetId, locationId, practiceId, practitionerId } =
      await setupBaseScheduleEntities(t);

    const firstCreate = await t.mutation(api.entities.createBaseScheduleBatch, {
      expectedDraftRevision: null,
      practiceId,
      schedules: [
        {
          dayOfWeek: 1,
          endTime: "12:00",
          locationId,
          practitionerId,
          startTime: "08:00",
        },
      ],
      selectedRuleSetId: initialRuleSetId,
    });
    const firstCreatedScheduleId = firstCreate.createdScheduleIds[0];
    assertDefined(
      firstCreatedScheduleId,
      "Expected created base schedule id from batch",
    );

    await expect(
      t.mutation(api.entities.createBaseScheduleBatch, {
        expectedDraftRevision: firstCreate.draftRevision,
        practiceId,
        schedules: [
          {
            dayOfWeek: 3,
            endTime: "14:00",
            lineageKey: firstCreatedScheduleId,
            locationId,
            practitionerId,
            startTime: "11:00",
          },
        ],
        selectedRuleSetId: initialRuleSetId,
      }),
    ).rejects.toThrow(/\[LINEAGE:BASE_SCHEDULE_DUPLICATE\]/);
  });

  test("should reject stale appointment type lineage keys and only delete current lineage", async () => {
    const t = createAuthedTestContext();

    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice) {
        throw new Error("Practice not found");
      }
      return practice;
    });

    if (!practice.currentActiveRuleSetId) {
      throw new Error("Practice has no active rule set");
    }
    const initialRuleSetId = practice.currentActiveRuleSetId;

    const practitionerId = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Appointment Type",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    const firstCreate = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: null,
      name: "Kontrolle",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: initialRuleSetId,
    });

    const firstDelete = await t.mutation(api.entities.deleteAppointmentType, {
      appointmentTypeId: firstCreate.entityId,
      appointmentTypeLineageKey: firstCreate.entityId,
      expectedDraftRevision: firstCreate.draftRevision,
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });
    expect(firstDelete.ruleSetId).toEqual(firstCreate.ruleSetId);

    const secondCreate = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: firstDelete.draftRevision,
      name: "Kontrolle",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: initialRuleSetId,
    });

    await expect(
      t.mutation(api.entities.deleteAppointmentType, {
        appointmentTypeId: firstCreate.entityId, // stale/deleted ID
        appointmentTypeLineageKey: firstCreate.entityId,
        expectedDraftRevision: secondCreate.draftRevision,
        practiceId,
        selectedRuleSetId: initialRuleSetId,
      }),
    ).rejects.toThrow(/gelöscht|deleted|APPOINTMENT_TYPE/);

    const remainingAfterFailedDelete = await t.run(async (ctx) => {
      const matches = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_name", (q) =>
          q.eq("ruleSetId", firstCreate.ruleSetId).eq("name", "Kontrolle"),
        )
        .collect();
      return matches.find(
        (appointmentType) => appointmentType.deleted !== true,
      );
    });

    expect(remainingAfterFailedDelete?._id).toEqual(secondCreate.entityId);

    await t.mutation(api.entities.deleteAppointmentType, {
      appointmentTypeId: secondCreate.entityId,
      appointmentTypeLineageKey: secondCreate.entityId,
      expectedDraftRevision: secondCreate.draftRevision,
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    const remainingAfterValidDelete = await t.run(async (ctx) => {
      const matches = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_name", (q) =>
          q.eq("ruleSetId", firstCreate.ruleSetId).eq("name", "Kontrolle"),
        )
        .collect();
      return matches.find(
        (appointmentType) => appointmentType._id === secondCreate.entityId,
      );
    });

    expect(remainingAfterValidDelete?._id).toEqual(secondCreate.entityId);
    expect(remainingAfterValidDelete?.deleted).toBe(true);
  });

  test("should remap rule condition appointment type IDs on delete and recreate", async () => {
    const t = createAuthedTestContext();

    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice) {
        throw new Error("Practice not found");
      }
      return practice;
    });

    if (!practice.currentActiveRuleSetId) {
      throw new Error("Practice has no active rule set");
    }
    const initialRuleSetId = practice.currentActiveRuleSetId;

    const practitionerId = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Remap",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    const createdType = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: null,
      name: "Akut",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: initialRuleSetId,
    });

    const createdRule = await t.mutation(api.entities.createRule, {
      conditionTree: {
        children: [
          {
            conditionType: "APPOINTMENT_TYPE",
            nodeType: "CONDITION",
            operator: "IS",
            valueIds: [createdType.entityId as string],
          },
        ],
        nodeType: "AND",
      },
      expectedDraftRevision: createdType.draftRevision,
      name: "Akut-Regel",
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    const deletedType = await t.mutation(api.entities.deleteAppointmentType, {
      appointmentTypeId: createdType.entityId,
      appointmentTypeLineageKey: createdType.entityId,
      expectedDraftRevision: createdRule.draftRevision,
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    const recreatedType = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: deletedType.draftRevision,
      lineageKey: createdType.entityId,
      name: "Akut",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: initialRuleSetId,
    });
    expect(recreatedType.entityId).toEqual(createdType.entityId);

    const ruleConditionNode = await t.run(async (ctx) => {
      return await ctx.db
        .query("ruleConditions")
        .withIndex("by_ruleSetId_conditionType", (q) =>
          q
            .eq("ruleSetId", recreatedType.ruleSetId)
            .eq("conditionType", "APPOINTMENT_TYPE"),
        )
        .first();
    });

    assertDefined(
      ruleConditionNode,
      "Expected appointment type condition node",
    );
    expect(ruleConditionNode.valueIds).toEqual([createdType.entityId]);
  });

  test("unsaved rule diff keeps rule appointment type names after delete and recreate", async () => {
    const t = createAuthedTestContext();

    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });
    const initialRuleSetId = await getInitialRuleSetId(t, practiceId);

    const practitionerId = await t.run(async (ctx) => {
      return await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Diff",
        practiceId,
        ruleSetId: initialRuleSetId,
      });
    });

    const createdType = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: null,
      name: "Akut-2",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: initialRuleSetId,
    });

    const createdRule = await t.mutation(api.entities.createRule, {
      conditionTree: {
        children: [
          {
            conditionType: "APPOINTMENT_TYPE",
            nodeType: "CONDITION",
            operator: "IS",
            valueIds: [createdType.entityId as string],
          },
          {
            conditionType: "DAY_OF_WEEK",
            nodeType: "CONDITION",
            operator: "IS",
            valueNumber: 1,
          },
        ],
        nodeType: "AND",
      },
      expectedDraftRevision: createdType.draftRevision,
      name: "Akut-Montag",
      practiceId,
      selectedRuleSetId: initialRuleSetId,
    });

    await t.mutation(api.ruleSets.saveUnsavedRuleSet, {
      description: "Saved with rule",
      practiceId,
      setAsActive: true,
    });

    const savedRuleSetId = await getInitialRuleSetId(t, practiceId);

    const deletedType = await t.mutation(api.entities.deleteAppointmentType, {
      appointmentTypeId: createdType.entityId,
      appointmentTypeLineageKey: createdType.entityId,
      expectedDraftRevision: null,
      practiceId,
      selectedRuleSetId: savedRuleSetId,
    });

    const recreatedType = await t.mutation(api.entities.createAppointmentType, {
      duration: 30,
      expectedDraftRevision: deletedType.draftRevision,
      lineageKey: createdType.entityId,
      name: "Akut-2",
      practiceId,
      practitionerIds: [practitionerId],
      selectedRuleSetId: savedRuleSetId,
    });

    const diff = await t.query(api.ruleSets.getUnsavedRuleSetDiff, {
      practiceId,
      ruleSetId: recreatedType.ruleSetId,
    });

    assertDefined(diff, "Expected diff for unsaved rule set");

    const rulesSection = diff.sections.find(
      (section) => section.key === "rules",
    );
    assertDefined(rulesSection, "Expected rules section in diff");
    expect(rulesSection.added).toEqual([]);
    expect(rulesSection.removed).toEqual([]);

    void createdRule;
  });

  test("should restore practitioner schedules by resolving location through deep lineage", async () => {
    const t = createAuthedTestContext();

    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    const seeded = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice?.currentActiveRuleSetId) {
        throw new Error("Practice has no active rule set");
      }

      const ruleSet1Id = practice.currentActiveRuleSetId;
      const ruleSet1 = await ctx.db.get("ruleSets", ruleSet1Id);
      if (!ruleSet1) {
        throw new Error("Initial rule set missing");
      }

      const location1Id = await insertWithLineage(ctx, "locations", {
        name: "Main Office",
        practiceId,
        ruleSetId: ruleSet1Id,
      });
      const practitioner1Id = await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Restore",
        practiceId,
        ruleSetId: ruleSet1Id,
      });

      const ruleSet2Id = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Saved v2",
        draftRevision: 0,
        parentVersion: ruleSet1Id,
        practiceId,
        saved: true,
        version: ruleSet1.version + 1,
      });

      const location2Id = await insertWithLineage(
        ctx,
        "locations",
        {
          name: "Main Office",
          parentId: location1Id,
          practiceId,
          ruleSetId: ruleSet2Id,
        },
        location1Id,
      );
      const practitioner2Id = await insertWithLineage(
        ctx,
        "practitioners",
        {
          name: "Dr. Restore",
          parentId: practitioner1Id,
          practiceId,
          ruleSetId: ruleSet2Id,
        },
        practitioner1Id,
      );

      const ruleSet3Id = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Draft v3",
        draftRevision: 0,
        parentVersion: ruleSet2Id,
        practiceId,
        saved: false,
        version: ruleSet1.version + 2,
      });

      const location3Id = await insertWithLineage(
        ctx,
        "locations",
        {
          name: "Main Office",
          parentId: location2Id,
          practiceId,
          ruleSetId: ruleSet3Id,
        },
        location1Id,
      );
      const practitioner3Id = await insertWithLineage(
        ctx,
        "practitioners",
        {
          name: "Dr. Restore",
          parentId: practitioner2Id,
          practiceId,
          ruleSetId: ruleSet3Id,
        },
        practitioner1Id,
      );

      await insertWithLineage(ctx, "baseSchedules", {
        dayOfWeek: 1,
        endTime: "17:00",
        locationId: location3Id,
        practiceId,
        practitionerId: practitioner3Id,
        ruleSetId: ruleSet3Id,
        startTime: "08:00",
      });

      return {
        location1Id,
        location2Id,
        practitioner3Id,
        ruleSet1Id,
        ruleSet2Id,
        ruleSet3Id,
      };
    });

    const deleteResult = await t.mutation(
      api.entities.deletePractitionerWithDependencies,
      {
        expectedDraftRevision: 0,
        practiceId,
        practitionerId: seeded.practitioner3Id,
        selectedRuleSetId: seeded.ruleSet2Id,
      },
    );

    expect(deleteResult.snapshot.baseSchedules).toHaveLength(1);
    expect(deleteResult.snapshot.baseSchedules[0]?.locationOriginId).toEqual(
      seeded.location2Id,
    );

    await t.mutation(api.ruleSets.deleteUnsavedRuleSet, {
      practiceId,
      ruleSetId: seeded.ruleSet3Id,
    });

    const restoreResult = await t.mutation(
      api.entities.restorePractitionerWithDependencies,
      {
        expectedDraftRevision: null,
        practiceId,
        selectedRuleSetId: seeded.ruleSet2Id,
        snapshot: deleteResult.snapshot,
      },
    );

    const restoredState = await t.run(async (ctx) => {
      const targetLocation = await ctx.db
        .query("locations")
        .withIndex("by_ruleSetId_lineageKey", (q) =>
          q
            .eq("ruleSetId", restoreResult.ruleSetId)
            .eq("lineageKey", seeded.location1Id),
        )
        .first();

      const restoredSchedules = await ctx.db
        .query("baseSchedules")
        .withIndex("by_ruleSetId_practitionerId", (q) =>
          q
            .eq("ruleSetId", restoreResult.ruleSetId)
            .eq("practitionerId", restoreResult.restoredPractitionerId),
        )
        .collect();

      return {
        restoredSchedules,
        targetLocation,
      };
    });

    assertDefined(
      restoredState.targetLocation,
      "Expected copied location in recreated draft",
    );
    expect(restoredState.restoredSchedules).toHaveLength(1);
    expect(restoredState.restoredSchedules[0]?.locationId).toEqual(
      restoredState.targetLocation._id,
    );
  });

  test("should expose stable practitioner lineageKey across deep rule-set lineage", async () => {
    const t = createAuthedTestContext();

    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    const seeded = await t.run(async (ctx) => {
      const practice = await ctx.db.get("practices", practiceId);
      if (!practice?.currentActiveRuleSetId) {
        throw new Error("Practice has no active rule set");
      }

      const ruleSet1Id = practice.currentActiveRuleSetId;
      const ruleSet1 = await ctx.db.get("ruleSets", ruleSet1Id);
      if (!ruleSet1) {
        throw new Error("Initial rule set missing");
      }

      const practitioner1Id = await insertWithLineage(ctx, "practitioners", {
        name: "Dr. Lineage",
        practiceId,
        ruleSetId: ruleSet1Id,
      });

      const ruleSet2Id = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Saved v2",
        draftRevision: 0,
        parentVersion: ruleSet1Id,
        practiceId,
        saved: true,
        version: ruleSet1.version + 1,
      });
      const practitioner2Id = await insertWithLineage(
        ctx,
        "practitioners",
        {
          name: "Dr. Lineage",
          parentId: practitioner1Id,
          practiceId,
          ruleSetId: ruleSet2Id,
        },
        practitioner1Id,
      );

      const ruleSet3Id = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Draft v3",
        draftRevision: 0,
        parentVersion: ruleSet2Id,
        practiceId,
        saved: false,
        version: ruleSet1.version + 2,
      });
      await insertWithLineage(
        ctx,
        "practitioners",
        {
          name: "Dr. Lineage",
          parentId: practitioner2Id,
          practiceId,
          ruleSetId: ruleSet3Id,
        },
        practitioner1Id,
      );

      return { practitioner1Id, ruleSet3Id };
    });

    const practitioners = await t.query(api.entities.getPractitioners, {
      ruleSetId: seeded.ruleSet3Id,
    });

    expect(practitioners).toHaveLength(1);
    expect(practitioners[0]?.lineageKey).toEqual(seeded.practitioner1Id);
  });
});

/**
 * Tests for Copy-on-Write entity reference validation
 */

import { convexTest } from "convex-test";
import { expect } from "vitest";
import { describe, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

describe("Copy-on-Write Entity Reference Validation", () => {
  test("should throw error when rule references appointment type from wrong rule set", async () => {
    const t = convexTest(schema, modules);

    // Create practice (this automatically creates an initial rule set)
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    // Get initial rule set (created by practice setup)
    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get(practiceId);
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
      return await ctx.db.insert("practitioners", {
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
        name: "Type 1",
        practiceId,
        practitionerIds: [practitioner],
        sourceRuleSetId: initialRuleSetId,
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
      name: "Type 2",
      practiceId,
      practitionerIds: [savedPractitioner._id],
      sourceRuleSetId: savedRuleSet1._id,
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

    // Now try to create a rule in the unsaved rule set that references
    // an appointment type from the OLD saved rule set
    // This should FAIL with our new validation
    await expect(
      t.mutation(api.entities.createRule, {
        conditionTree: {
          children: [
            {
              conditionType: "APPOINTMENT_TYPE",
              nodeType: "CONDITION",
              operator: "IS",
              // BUG: Using appointment type ID from old rule set!
              valueIds: [appointmentType1.entityId as string],
            },
          ],
          nodeType: "AND",
        },
        name: "Test Rule",
        practiceId,
        sourceRuleSetId: unsavedRuleSet._id,
      }),
    ).rejects.toThrow(/belongs to rule set .* but expected rule set/);
  });

  test("should succeed when rule references appointment type from correct rule set", async () => {
    const t = convexTest(schema, modules);

    // Create practice (this automatically creates an initial rule set)
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    // Get initial rule set
    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get(practiceId);
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
      return await ctx.db.insert("practitioners", {
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
        name: "Correct Type",
        practiceId,
        practitionerIds: [practitioner],
        sourceRuleSetId: initialRuleSetId,
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
      name: "Test Rule",
      practiceId,
      sourceRuleSetId: unsavedRuleSet._id,
    });

    expect(result.entityId).toBeDefined();
    expect(result.ruleSetId).toEqual(unsavedRuleSet._id);
  });

  test("should correctly remap appointment type IDs when copying rule sets", async () => {
    const t = convexTest(schema, modules);

    // Create practice (this automatically creates an initial rule set)
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    // Get initial rule set
    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get(practiceId);
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
      return await ctx.db.insert("practitioners", {
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
        name: "Type 1",
        practiceId,
        practitionerIds: [practitioner],
        sourceRuleSetId: initialRuleSetId,
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
      name: "Test Rule",
      practiceId,
      sourceRuleSetId: unsavedRuleSet._id,
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
      name: "Type 2",
      practiceId,
      practitionerIds: [savedPractitioner._id],
      sourceRuleSetId: savedRuleSet1._id,
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
      if (node.valueIds) {
        for (const id of node.valueIds) {
          const appointmentType = await t.run(async (ctx) => {
            return await ctx.db.get(id as Id<"appointmentTypes">);
          });

          expect(appointmentType).toBeDefined();
          if (!appointmentType) {
            throw new Error(`Appointment type ${id} not found`);
          }
          expect(appointmentType.ruleSetId).toEqual(unsavedRuleSet._id);
          // This is the key assertion - the referenced entity belongs to the same rule set
        }
      }
    }
  });

  test("should correctly handle CONCURRENT_COUNT conditions with appointment type IDs", async () => {
    const t = convexTest(schema, modules);

    // Create practice (this automatically creates an initial rule set)
    const practiceId = await t.mutation(api.practices.createPractice, {
      name: "Test Practice",
    });

    // Get initial rule set
    const practice = await t.run(async (ctx) => {
      const practice = await ctx.db.get(practiceId);
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
      return await ctx.db.insert("practitioners", {
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
        name: "Surgery",
        practiceId,
        practitionerIds: [practitioner],
        sourceRuleSetId: initialRuleSetId,
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
    // valueIds structure: [scope, ...appointmentTypeIds]
    const result = await t.mutation(api.entities.createRule, {
      conditionTree: {
        children: [
          {
            conditionType: "CONCURRENT_COUNT",
            nodeType: "CONDITION",
            operator: "GREATER_THAN_OR_EQUAL",
            valueIds: ["practice", appointmentType.entityId as string],
            valueNumber: 2,
          },
        ],
        nodeType: "AND",
      },
      name: "Concurrent Test Rule",
      practiceId,
      sourceRuleSetId: unsavedRuleSet._id,
    });

    expect(result.entityId).toBeDefined();
    expect(result.ruleSetId).toEqual(unsavedRuleSet._id);

    // Verify the rule was created with the correct valueIds structure
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
    expect(concurrentCondition.valueIds).toEqual([
      "practice",
      appointmentType.entityId,
    ]);
  });
});

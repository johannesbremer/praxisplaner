/**
 * Rules Engine Test Suite
 *
 * This test suite validates the rule evaluation logic that determines whether
 * appointments should be blocked based on various conditions and combinations.
 *
 * Test Structure:
 * 1. Helper functions to set up test data (practices, practitioners, locations, etc.)
 * 2. Tests for individual condition types (APPOINTMENT_TYPE, DAY_OF_WEEK, etc.)
 * 3. Tests for numeric comparison conditions (DAYS_AHEAD, CONCURRENT_COUNT, etc.)
 * 4. Tests for compound conditions (multiple conditions with AND logic)
 * 5. Tests for edge cases and validation
 *
 * Each test follows this pattern:
 * - Set up test data (practice, practitioners, locations, appointment types)
 * - Create a rule set with specific conditions
 * - Generate German description of expected behavior
 * - Check appointments against the rules
 * - Assert which appointments should be blocked vs. allowed (per the description)
 */

import { convexTest } from "convex-test";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import type { ConditionTreeNode } from "../ruleEngine";

import {
  conditionTreeToConditions,
  generateRuleName,
} from "../../lib/rule-name-generator.js";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "./test.setup";

// ================================
// TEST HELPER FUNCTIONS
// ================================

/**
 * Wrapper around convexTest that includes our modules.
 */
function createTestContext() {
  return convexTest(schema, modules);
}

/**
 * Helper to create a practice and return its ID.
 */
async function createPractice(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const practiceId = await ctx.db.insert("practices", {
      name: "Test Practice",
    });
    return practiceId;
  });
}

/**
 * Helper to create a rule set for a practice.
 */
async function createRuleSet(
  t: ReturnType<typeof convexTest>,
  practiceId: Id<"practices">,
  saved = false,
) {
  return await t.run(async (ctx) => {
    const ruleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      description: saved ? "Test Rule Set" : "Unsaved Draft",
      practiceId,
      saved,
      version: 1,
    });
    return ruleSetId;
  });
}

/**
 * Helper to create a practitioner in a rule set.
 */
async function createPractitioner(
  t: ReturnType<typeof convexTest>,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  name: string,
  tags?: string[],
) {
  return await t.run(async (ctx) => {
    const practitionerId = await ctx.db.insert("practitioners", {
      name,
      practiceId,
      ruleSetId,
      ...(tags && { tags }),
    });
    return practitionerId;
  });
}

/**
 * Helper to create a location in a rule set.
 */
async function createLocation(
  t: ReturnType<typeof convexTest>,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  name: string,
) {
  return await t.run(async (ctx) => {
    const locationId = await ctx.db.insert("locations", {
      name,
      practiceId,
      ruleSetId,
    });
    return locationId;
  });
}

/**
 * Helper to create an appointment type in a rule set.
 */
async function createAppointmentType(
  t: ReturnType<typeof convexTest>,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  name: string,
  practitionerIds: Id<"practitioners">[],
  duration = 30,
) {
  return await t.run(async (ctx) => {
    const appointmentTypeId = await ctx.db.insert("appointmentTypes", {
      allowedPractitionerIds: practitionerIds,
      createdAt: BigInt(Date.now()),
      duration,
      lastModified: BigInt(Date.now()),
      name,
      practiceId,
      ruleSetId,
    });
    return appointmentTypeId;
  });
}

/**
 * Helper to create a rule with condition tree.
 * This mimics what the UI does when creating rules through the dialog.
 */
async function createRule(
  t: ReturnType<typeof convexTest>,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  conditionTree: ConditionTreeNode,
  enabled = true,
) {
  return await t.run(async (ctx) => {
    const now = BigInt(Date.now());

    // Create root node
    const rootId = await ctx.db.insert("ruleConditions", {
      childOrder: 0,
      createdAt: now,
      enabled,
      isRoot: true,
      lastModified: now,
      practiceId,
      ruleSetId,
    });

    // Helper to recursively create condition tree nodes
    async function createTreeNode(
      node: ConditionTreeNode,
      parentId: Id<"ruleConditions">,
      order: number,
    ): Promise<Id<"ruleConditions">> {
      const nodeId = await ctx.db.insert("ruleConditions", {
        childOrder: order,
        isRoot: false,
        nodeType: node.nodeType,
        parentConditionId: parentId,
        practiceId,
        ruleSetId,
        ...("conditionType" in node && { conditionType: node.conditionType }),
        ...("operator" in node && { operator: node.operator }),
        ...("valueIds" in node && { valueIds: node.valueIds }),
        ...("valueNumber" in node && { valueNumber: node.valueNumber }),
        createdAt: now,
        lastModified: now,
      });

      // If this is a logical operator (AND/NOT), create its children
      if ("children" in node) {
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          await createTreeNode(child as ConditionTreeNode, nodeId, i);
        }
      }

      return nodeId;
    }

    // Create the condition tree starting from the root
    await createTreeNode(conditionTree, rootId, 0);

    return rootId;
  });
}

/**
 * Helper to create an appointment (for testing concurrent/same-day counts).
 */
async function createAppointment(
  t: ReturnType<typeof convexTest>,
  practiceId: Id<"practices">,
  practitionerId: Id<"practitioners">,
  locationId: Id<"locations">,
  appointmentTypeId: Id<"appointmentTypes">,
  startTime: string,
  duration = 30,
) {
  return await t.run(async (ctx) => {
    // Parse the start time and calculate end time
    // Use Temporal to ensure consistent ISO string format
    const startInstant = Temporal.Instant.from(startTime);
    const endInstant = startInstant.add({ milliseconds: duration * 60 * 1000 });

    const appointmentType = (await ctx.db.get(
      appointmentTypeId,
    )) as Doc<"appointmentTypes"> | null;
    if (!appointmentType) {
      throw new Error(`Appointment type ${appointmentTypeId} not found`);
    }

    const appointmentId = await ctx.db.insert("appointments", {
      appointmentTypeId,
      createdAt: BigInt(Date.now()),
      end: endInstant.toString(),
      lastModified: BigInt(Date.now()),
      locationId,
      practiceId,
      practitionerId,
      start: startInstant.toString(),
      title: appointmentType.name, // Store appointment type name at booking time
    });
    return appointmentId;
  });
}

// ================================
// TESTS: SIMPLE FILTER CONDITIONS
// ================================

describe("Rule Engine: Simple Filter Conditions", () => {
  test("APPOINTMENT_TYPE with IS operator - should block matching type", async () => {
    const t = createTestContext();

    // Setup
    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(
      t,
      practiceId,
      ruleSetId,
      "Main Office",
    );

    // Create appointment types
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );
    const consultationTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Consultation",
      [practitionerId],
    );

    // Create rule: Block "Checkup" appointments
    const conditionTree = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [checkupTypeId],
    };

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Checkup appointment should be blocked
    const checkupResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(checkupResult.isBlocked).toBe(true);
    expect(checkupResult.blockedByRuleIds).toHaveLength(1);

    // Test: Different appointment type should be allowed
    const consultationResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: consultationTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(consultationResult.isBlocked).toBe(false);
    expect(consultationResult.blockedByRuleIds).toHaveLength(0);
  });

  test("APPOINTMENT_TYPE with IS operator using IDs (real-world scenario) - should block matching type", async () => {
    const t = createTestContext();

    // Setup
    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(
      t,
      practiceId,
      ruleSetId,
      "Main Office",
    );

    // Create appointment types in the database (like the UI does)
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );
    const consultationTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Consultation",
      [practitionerId],
    );

    // Create rule: Block "Checkup" appointments using the ID (as the UI does)
    const conditionTree = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [checkupTypeId], // Using ID, not name!
    };

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Checkup appointment should be blocked
    // BUT: context.appointmentType is the NAME "Checkup", not the ID!
    const checkupResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId, // This is a NAME, not an ID
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    // This test will FAIL because we're comparing ID to NAME
    expect(checkupResult.isBlocked).toBe(true);
    expect(checkupResult.blockedByRuleIds).toHaveLength(1);

    // Test: Different appointment type should be allowed
    const consultationResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: consultationTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(consultationResult.isBlocked).toBe(false);
    expect(consultationResult.blockedByRuleIds).toHaveLength(0);
  });

  test("APPOINTMENT_TYPE with IS_NOT operator - should block everything except specified type", async () => {
    // Expected rule: "Wenn der Termintyp nicht Emergency ist, darf der Termin nicht vergeben werden."
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Clinic");

    // Create appointment types
    const emergencyTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Emergency",
      [practitionerId],
    );
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule: Block everything EXCEPT "Emergency"
    const conditionTree = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS_NOT" as const,
      valueIds: [emergencyTypeId],
    };

    // Expected behavior: "Wenn der Termintyp nicht Emergency ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: "Emergency", name: "Emergency" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Emergency should be allowed
    const emergencyResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: emergencyTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(emergencyResult.isBlocked).toBe(false);

    // Test: Any other type should be blocked
    const checkupResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(checkupResult.isBlocked).toBe(true);
  });

  test("PRACTITIONER with IS operator - should block specific practitioner", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [drSmithId, drJonesId],
    );

    // Create rule: Block appointments with Dr. Smith
    const conditionTree = {
      conditionType: "PRACTITIONER" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [drSmithId],
    };

    // Expected behavior: "Wenn der Behandler Dr. Smith ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [{ _id: drSmithId, name: "Dr. Smith" }],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Dr. Smith should be blocked
    const smithResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId: drSmithId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(smithResult.isBlocked).toBe(true);

    // Test: Dr. Jones should be allowed
    const jonesResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId: drJonesId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(jonesResult.isBlocked).toBe(false);
  });

  test("LOCATION with IS operator - should block specific location", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const mainOfficeId = await createLocation(
      t,
      practiceId,
      ruleSetId,
      "Main Office",
    );
    const branchId = await createLocation(t, practiceId, ruleSetId, "Branch");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule: Block appointments at Main Office
    const conditionTree = {
      conditionType: "LOCATION" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [mainOfficeId],
    };

    // Expected behavior: "Wenn der Standort Main Office ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [],
      [{ _id: mainOfficeId, name: "Main Office" }],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Main Office should be blocked
    const mainOfficeResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId: mainOfficeId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(mainOfficeResult.isBlocked).toBe(true);

    // Test: Branch should be allowed
    const branchResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId: branchId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(branchResult.isBlocked).toBe(false);
  });

  test("DAY_OF_WEEK with IS operator - should block specific day", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule: Block Monday appointments (1 = Monday)
    const conditionTree = {
      conditionType: "DAY_OF_WEEK" as const,
      nodeType: "CONDITION" as const,
      operator: "EQUALS" as const,
      valueNumber: 1,
    };

    // Expected behavior: "Wenn es Montag ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Monday (2025-10-27 is a Monday) should be blocked
    const mondayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z", // Monday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(mondayResult.isBlocked).toBe(true);

    // Test: Tuesday (2025-10-28) should be allowed
    const tuesdayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-28T10:00:00.000Z", // Tuesday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(tuesdayResult.isBlocked).toBe(false);
  });

  test("Multiple valueIds with IS operator - should block any matching value", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );
    const consultationTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Consultation",
      [practitionerId],
    );
    const emergencyTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Emergency",
      [practitionerId],
    );

    // Create rule: Block "Checkup" OR "Consultation"
    const conditionTree = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [checkupTypeId, consultationTypeId],
    };

    // Expected behavior: "Wenn der Termintyp Checkup oder Consultation ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [
        { _id: checkupTypeId, name: "Checkup" },
        { _id: consultationTypeId, name: "Consultation" },
      ],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Both types should be blocked
    const checkupResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(checkupResult.isBlocked).toBe(true);

    const consultationResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: consultationTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(consultationResult.isBlocked).toBe(true);

    // Test: Other types should be allowed
    const emergencyResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: emergencyTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(emergencyResult.isBlocked).toBe(false);
  });
});

// ================================
// TESTS: NUMERIC COMPARISON CONDITIONS
// ================================

describe("Rule Engine: Numeric Comparison Conditions", () => {
  test("DAYS_AHEAD with GREATER_THAN_OR_EQUAL - should block appointments too far in advance", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule: Block appointments >= 30 days ahead
    const conditionTree = {
      conditionType: "DAYS_AHEAD" as const,
      nodeType: "CONDITION" as const,
      operator: "GREATER_THAN_OR_EQUAL" as const,
      valueNumber: 30,
    };

    // Expected behavior: "Wenn der Termin 30 Tage oder mehr entfernt ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    const requestTime = "2025-10-24T10:00:00.000Z";

    // Test: 29 days ahead should be allowed
    const nearResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-22T10:00:00.000Z", // 29 days ahead
          locationId,
          practiceId,
          practitionerId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(nearResult.isBlocked).toBe(false);

    // Test: 30 days ahead should be blocked
    const exactResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-23T10:00:00.000Z", // 30 days ahead
          locationId,
          practiceId,
          practitionerId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(exactResult.isBlocked).toBe(true);

    // Test: 60 days ahead should be blocked
    const farResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-12-23T10:00:00.000Z", // 60 days ahead
          locationId,
          practiceId,
          practitionerId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(farResult.isBlocked).toBe(true);
  });

  test("CONCURRENT_COUNT with practice scope - should block when too many concurrent appointments", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [drSmithId, drJonesId],
    );
    const consultationTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Consultation",
      [drSmithId, drJonesId],
    );

    const timeSlot = Temporal.Instant.from(
      "2025-10-27T10:00:00.000Z",
    ).toString();

    // Create 2 existing appointments at the same time
    await createAppointment(
      t,
      practiceId,
      drSmithId,
      locationId,
      checkupTypeId,
      timeSlot,
    );
    await createAppointment(
      t,
      practiceId,
      drJonesId,
      locationId,
      consultationTypeId,
      timeSlot,
    );

    // Create rule: Block if >= 2 concurrent appointments at practice level (any type)
    const conditionTree = {
      conditionType: "CONCURRENT_COUNT" as const,
      nodeType: "CONDITION" as const,
      operator: "GREATER_THAN_OR_EQUAL" as const,
      scope: "practice" as const, // New format: scope is separate field
      valueIds: [], // No appointment types means count all types
      valueNumber: 2,
    };

    // Expected behavior: "Wenn gleichzeitig 2 oder mehr Termine in der gesamten Praxis gebucht wurden, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Third concurrent appointment should be blocked
    const blockedResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: timeSlot,
          locationId,
          practiceId,
          practitionerId: drSmithId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(blockedResult.isBlocked).toBe(true);

    // Test: Appointment at different time should be allowed
    const allowedResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: Temporal.Instant.from(
            "2025-10-27T11:00:00.000Z",
          ).toString(), // Different time
          locationId,
          practiceId,
          practitionerId: drSmithId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(allowedResult.isBlocked).toBe(false);
  });
});

// ================================
// TESTS: COMPOUND CONDITIONS (AND LOGIC)
// ================================

describe("Rule Engine: Compound Conditions", () => {
  test("AND with two conditions - both must match to block", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );
    const consultationTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Consultation",
      [practitionerId],
    );

    // Create rule: Block "Checkup" appointments on Mondays
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [checkupTypeId],
        },
        {
          conditionType: "DAY_OF_WEEK" as const,
          nodeType: "CONDITION" as const,
          operator: "EQUALS" as const,
          valueNumber: 1, // Monday
        },
      ],
      nodeType: "AND" as const,
    };

    // Expected behavior: "Wenn der Termintyp Checkup ist und es Montag ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: checkupTypeId, name: "Checkup" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Checkup on Monday should be blocked
    const blockedResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z", // Monday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(blockedResult.isBlocked).toBe(true);

    // Test: Checkup on Tuesday should be allowed (day doesn't match)
    const allowedDayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-28T10:00:00.000Z", // Tuesday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(allowedDayResult.isBlocked).toBe(false);

    // Test: Consultation on Monday should be allowed (type doesn't match)
    const allowedTypeResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: consultationTypeId,
          dateTime: "2025-10-27T10:00:00.000Z", // Monday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(allowedTypeResult.isBlocked).toBe(false);
  });

  test("AND with three conditions - all must match to block", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const mainOfficeId = await createLocation(
      t,
      practiceId,
      ruleSetId,
      "Main Office",
    );
    const branchId = await createLocation(t, practiceId, ruleSetId, "Branch");

    // Create appointment types
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [drSmithId, drJonesId],
    );
    const consultationTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Consultation",
      [drSmithId, drJonesId],
    );

    // Create rule: Block "Checkup" with "Dr. Smith" at "Main Office"
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [checkupTypeId],
        },
        {
          conditionType: "PRACTITIONER" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [drSmithId],
        },
        {
          conditionType: "LOCATION" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [mainOfficeId],
        },
      ],
      nodeType: "AND" as const,
    };

    // Expected behavior: "Wenn der Termintyp Checkup ist und der Behandler Dr. Smith ist und der Standort Main Office ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: checkupTypeId, name: "Checkup" }],
      [{ _id: drSmithId, name: "Dr. Smith" }],
      [{ _id: mainOfficeId, name: "Main Office" }],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: All three match - should be blocked
    const blockedResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId: mainOfficeId,
          practiceId,
          practitionerId: drSmithId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(blockedResult.isBlocked).toBe(true);

    // Test: Different practitioner - should be allowed
    const allowedPractitionerResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId: mainOfficeId,
          practiceId,
          practitionerId: drJonesId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(allowedPractitionerResult.isBlocked).toBe(false);

    // Test: Different location - should be allowed
    const allowedLocationResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId: branchId,
          practiceId,
          practitionerId: drSmithId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(allowedLocationResult.isBlocked).toBe(false);

    // Test: Different appointment type - should be allowed
    const allowedTypeResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: consultationTypeId,
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId: mainOfficeId,
          practiceId,
          practitionerId: drSmithId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(allowedTypeResult.isBlocked).toBe(false);
  });

  test("Nested AND conditions - complex rule composition", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule: Block "Checkup" appointments that are:
    // - On Monday OR Tuesday (day 1 or 2)
    // - AND more than 14 days in advance
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [checkupTypeId],
        },
        {
          children: [
            {
              conditionType: "DAY_OF_WEEK" as const,
              nodeType: "CONDITION" as const,
              operator: "EQUALS" as const,
              valueNumber: 1, // Monday
            },
            {
              conditionType: "DAYS_AHEAD" as const,
              nodeType: "CONDITION" as const,
              operator: "GREATER_THAN_OR_EQUAL" as const,
              valueNumber: 14,
            },
          ],
          nodeType: "AND" as const,
        },
      ],
      nodeType: "AND" as const,
    };

    // Expected behavior: "Wenn der Termintyp Checkup ist und es Montag ist und der Termin 14 Tage oder mehr entfernt ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: checkupTypeId, name: "Checkup" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    const requestTime = "2025-10-24T10:00:00.000Z";

    // Test: Checkup on Monday, 20 days ahead - should be blocked
    const blockedResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-17T10:00:00.000Z", // Monday, 24 days ahead
          locationId,
          practiceId,
          practitionerId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(blockedResult.isBlocked).toBe(true);

    // Test: Checkup on Monday, 10 days ahead - should be allowed
    const allowedDaysResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-03T10:00:00.000Z", // Monday, 10 days ahead
          locationId,
          practiceId,
          practitionerId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(allowedDaysResult.isBlocked).toBe(false);

    // Test: Checkup on Wednesday, 20 days ahead - should be allowed
    const allowedDayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-19T10:00:00.000Z", // Wednesday, 26 days ahead
          locationId,
          practiceId,
          practitionerId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(allowedDayResult.isBlocked).toBe(false);
  });
});

// ================================
// TESTS: MULTIPLE RULES
// ================================

describe("Rule Engine: Multiple Rules", () => {
  test("Multiple rules - appointment blocked if ANY rule matches", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );
    const consultationTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Consultation",
      [practitionerId],
    );

    // Rule 1: Block "Checkup" appointments
    const conditionTree1 = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [checkupTypeId],
    };

    // Expected behavior: "Wenn der Termintyp Checkup ist, darf der Termin nicht vergeben werden."
    const expectedRule1 = generateRuleName(
      conditionTreeToConditions(conditionTree1),
      [{ _id: checkupTypeId, name: "Checkup" }],
      [],
      [],
    );
    console.log("Expected Rule 1:", expectedRule1);

    await createRule(t, practiceId, ruleSetId, conditionTree1);

    // Rule 2: Block Monday appointments
    const conditionTree2 = {
      conditionType: "DAY_OF_WEEK" as const,
      nodeType: "CONDITION" as const,
      operator: "EQUALS" as const,
      valueNumber: 1,
    };

    // Expected behavior: "Wenn es Montag ist, darf der Termin nicht vergeben werden."
    const expectedRule2 = generateRuleName(
      conditionTreeToConditions(conditionTree2),
      [],
      [],
      [],
    );
    console.log("Expected Rule 2:", expectedRule2);

    await createRule(t, practiceId, ruleSetId, conditionTree2);

    // Test: Checkup on Tuesday - blocked by rule 1
    const checkupTuesdayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-28T10:00:00.000Z", // Tuesday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(checkupTuesdayResult.isBlocked).toBe(true);
    expect(checkupTuesdayResult.blockedByRuleIds).toHaveLength(1);

    // Test: Consultation on Monday - blocked by rule 2
    const consultationMondayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: consultationTypeId,
          dateTime: "2025-10-27T10:00:00.000Z", // Monday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(consultationMondayResult.isBlocked).toBe(true);
    expect(consultationMondayResult.blockedByRuleIds).toHaveLength(1);

    // Test: Checkup on Monday - blocked by BOTH rules
    const checkupMondayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T10:00:00.000Z", // Monday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(checkupMondayResult.isBlocked).toBe(true);
    expect(checkupMondayResult.blockedByRuleIds.length).toBeGreaterThanOrEqual(
      1,
    );

    // Test: Consultation on Tuesday - allowed
    const consultationTuesdayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: consultationTypeId,
          dateTime: "2025-10-28T10:00:00.000Z", // Tuesday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(consultationTuesdayResult.isBlocked).toBe(false);
    expect(consultationTuesdayResult.blockedByRuleIds).toHaveLength(0);
  });

  test("Disabled rules should not block appointments", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create a DISABLED rule
    const conditionTree = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [checkupTypeId],
    };

    // Expected behavior (if enabled): "Wenn der Termintyp Checkup ist, darf der Termin nicht vergeben werden."
    // But this rule is DISABLED, so it should not block anything
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: checkupTypeId, name: "Checkup" }],
      [],
      [],
    );
    console.log("Expected (but DISABLED):", expectedRule);

    await createRule(
      t,
      practiceId,
      ruleSetId,
      conditionTree,
      false, // disabled
    );

    // Test: Should be allowed even though it matches the condition
    const result = await t.query(internal.ruleEngine.checkRulesForAppointment, {
      context: {
        appointmentTypeId: checkupTypeId,
        dateTime: "2025-10-27T10:00:00.000Z",
        locationId,
        practiceId,
        practitionerId,
        requestedAt: "2025-10-24T10:00:00.000Z",
      },
      ruleSetId,
    });

    expect(result.isBlocked).toBe(false);
    expect(result.blockedByRuleIds).toHaveLength(0);
  });
});

// ================================
// TESTS: EDGE CASES
// ================================

describe("Rule Engine: Edge Cases", () => {
  test("Empty rule set - all appointments allowed", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // No rules created

    const result = await t.query(internal.ruleEngine.checkRulesForAppointment, {
      context: {
        appointmentTypeId: checkupTypeId,
        dateTime: "2025-10-27T10:00:00.000Z",
        locationId,
        practiceId,
        practitionerId,
        requestedAt: "2025-10-24T10:00:00.000Z",
      },
      ruleSetId,
    });

    expect(result.isBlocked).toBe(false);
    expect(result.blockedByRuleIds).toHaveLength(0);
  });

  test("Rule with empty valueIds array - should not block anything", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule with empty valueIds
    await createRule(t, practiceId, ruleSetId, {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [],
    });

    const result = await t.query(internal.ruleEngine.checkRulesForAppointment, {
      context: {
        appointmentTypeId: checkupTypeId,
        dateTime: "2025-10-27T10:00:00.000Z",
        locationId,
        practiceId,
        practitionerId,
        requestedAt: "2025-10-24T10:00:00.000Z",
      },
      ruleSetId,
    });

    expect(result.isBlocked).toBe(false);
  });

  test("Same-day booking (0 days ahead) with DAYS_AHEAD >= 7 rule", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule: Block appointments >= 7 days ahead
    await createRule(t, practiceId, ruleSetId, {
      conditionType: "DAYS_AHEAD" as const,
      nodeType: "CONDITION" as const,
      operator: "GREATER_THAN_OR_EQUAL" as const,
      valueNumber: 7,
    });

    const now = "2025-10-24T10:00:00.000Z";

    // Test: Same-day booking should be allowed
    const sameDayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: now,
          locationId,
          practiceId,
          practitionerId,
          requestedAt: now,
        },
        ruleSetId,
      },
    );

    expect(sameDayResult.isBlocked).toBe(false);

    // Test: Tomorrow (1 day ahead) should be allowed
    const tomorrowResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-25T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: now,
        },
        ruleSetId,
      },
    );

    expect(tomorrowResult.isBlocked).toBe(false);

    // Test: 7 days ahead should be blocked
    const weekAheadResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-31T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: now,
        },
        ruleSetId,
      },
    );

    expect(weekAheadResult.isBlocked).toBe(true);
  });

  test("Weekend days (Saturday=6, Sunday=0) blocking", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create two rules: Block Saturday and Sunday
    const conditionTree1 = {
      conditionType: "DAY_OF_WEEK" as const,
      nodeType: "CONDITION" as const,
      operator: "EQUALS" as const,
      valueNumber: 6, // Saturday
    };

    // Expected behavior: "Wenn es Samstag ist, darf der Termin nicht vergeben werden."
    const expectedRule1 = generateRuleName(
      conditionTreeToConditions(conditionTree1),
      [],
      [],
      [],
    );
    console.log("Expected Rule 1:", expectedRule1);

    await createRule(t, practiceId, ruleSetId, conditionTree1);

    const conditionTree2 = {
      conditionType: "DAY_OF_WEEK" as const,
      nodeType: "CONDITION" as const,
      operator: "EQUALS" as const,
      valueNumber: 0, // Sunday
    };

    // Expected behavior: "Wenn es Sonntag ist, darf der Termin nicht vergeben werden."
    const expectedRule2 = generateRuleName(
      conditionTreeToConditions(conditionTree2),
      [],
      [],
      [],
    );
    console.log("Expected Rule 2:", expectedRule2);

    await createRule(t, practiceId, ruleSetId, conditionTree2);

    // Test: Saturday (2025-11-01) should be blocked
    const saturdayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-01T10:00:00.000Z", // Saturday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(saturdayResult.isBlocked).toBe(true);

    // Test: Sunday (2025-11-02) should be blocked
    const sundayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-02T10:00:00.000Z", // Sunday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(sundayResult.isBlocked).toBe(true);

    // Test: Friday (2025-10-31) should be allowed
    const fridayResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-31T10:00:00.000Z", // Friday
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(fridayResult.isBlocked).toBe(false);
  });
});

// ================================
// TESTS: REAL-WORLD SCENARIOS
// ================================

describe("Rule Engine: Real-World Scenarios", () => {
  test("Block online bookings for specific appointment types", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const surgeryTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Surgery",
      [practitionerId],
    );
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule: Block "Surgery" appointments when clientType is "Online"
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [surgeryTypeId],
        },
        {
          conditionType: "CLIENT_TYPE",
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: ["Online"],
        },
      ],
      nodeType: "AND" as const,
    };

    // Expected behavior: "Wenn der Termintyp Surgery ist und der Client-Typ Online ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: surgeryTypeId, name: "Surgery" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Online Surgery booking should be blocked
    const onlineSurgeryResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: surgeryTypeId,
          clientType: "Online",
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(onlineSurgeryResult.isBlocked).toBe(true);

    // Test: MFA Surgery booking should be allowed
    const mfaSurgeryResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: surgeryTypeId,
          clientType: "MFA",
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(mfaSurgeryResult.isBlocked).toBe(false);

    // Test: Online Checkup should be allowed
    const onlineCheckupResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          clientType: "Online",
          dateTime: "2025-10-27T10:00:00.000Z",
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(onlineCheckupResult.isBlocked).toBe(false);
  });

  test("Prevent early morning appointments on Mondays", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create rule: Block appointments on Monday
    // (In a real implementation, you'd also add a TIME_RANGE condition for before 9 AM)
    const conditionTree = {
      conditionType: "DAY_OF_WEEK" as const,
      nodeType: "CONDITION" as const,
      operator: "EQUALS" as const,
      valueNumber: 1, // Monday
    };

    // Expected behavior: "Wenn es Montag ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Monday morning should be blocked
    const mondayMorningResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-27T07:00:00.000Z", // Monday 7 AM
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(mondayMorningResult.isBlocked).toBe(true);

    // Test: Tuesday morning should be allowed
    const tuesdayMorningResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-10-28T07:00:00.000Z", // Tuesday 7 AM
          locationId,
          practiceId,
          practitionerId,
          requestedAt: "2025-10-24T10:00:00.000Z",
        },
        ruleSetId,
      },
    );

    expect(tuesdayMorningResult.isBlocked).toBe(false);
  });

  test("Limit advance booking for specific practitioners", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [drSmithId, drJonesId],
    );

    // Create rule: Block Dr. Smith appointments more than 14 days ahead
    const conditionTree = {
      children: [
        {
          conditionType: "PRACTITIONER" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [drSmithId],
        },
        {
          conditionType: "DAYS_AHEAD" as const,
          nodeType: "CONDITION" as const,
          operator: "GREATER_THAN_OR_EQUAL" as const,
          valueNumber: 14,
        },
      ],
      nodeType: "AND" as const,
    };

    // Expected behavior: "Wenn der Behandler Dr. Smith ist und der Termin 14 Tage oder mehr entfernt ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [{ _id: drSmithId, name: "Dr. Smith" }],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    const requestTime = "2025-10-24T10:00:00.000Z";

    // Test: Dr. Smith 20 days ahead should be blocked
    const smithFarResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-13T10:00:00.000Z", // 20 days ahead
          locationId,
          practiceId,
          practitionerId: drSmithId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(smithFarResult.isBlocked).toBe(true);

    // Test: Dr. Smith 10 days ahead should be allowed
    const smithNearResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-03T10:00:00.000Z", // 10 days ahead
          locationId,
          practiceId,
          practitionerId: drSmithId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(smithNearResult.isBlocked).toBe(false);

    // Test: Dr. Jones 20 days ahead should be allowed
    const jonesFarResult = await t.query(
      internal.ruleEngine.checkRulesForAppointment,
      {
        context: {
          appointmentTypeId: checkupTypeId,
          dateTime: "2025-11-13T10:00:00.000Z", // 20 days ahead
          locationId,
          practiceId,
          practitionerId: drJonesId,
          requestedAt: requestTime,
        },
        ruleSetId,
      },
    );

    expect(jonesFarResult.isBlocked).toBe(false);
  });
});

// ================================
// E2E TESTS: SLOT GENERATION WITH RULES
// ================================

/**
 * Helper to create a base schedule for testing slot generation.
 */
async function createBaseSchedule(
  t: ReturnType<typeof convexTest>,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  practitionerId: Id<"practitioners">,
  locationId: Id<"locations">,
  dayOfWeek: number,
  startTime = "09:00",
  endTime = "17:00",
) {
  return await t.run(async (ctx) => {
    const scheduleId = await ctx.db.insert("baseSchedules", {
      breakTimes: [],
      dayOfWeek,
      endTime,
      locationId,
      practiceId,
      practitionerId,
      ruleSetId,
      startTime,
    });
    return scheduleId;
  });
}

describe("E2E: Slot Generation with Rules", () => {
  test("DAY_OF_WEEK rule blocks all slots on Monday", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const generalTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "General",
      [practitionerId],
    );

    // Create base schedule: Monday-Friday 9am-5pm
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      1,
    ); // Monday

    // Create rule: Block Monday appointments
    const conditionTree = {
      conditionType: "DAY_OF_WEEK" as const,
      nodeType: "CONDITION" as const,
      operator: "EQUALS" as const,
      valueNumber: 1,
    };

    // Expected behavior: "Wenn es Montag ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    const ruleId = await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Get slots for Monday
    const mondaySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: generalTypeId,
        patient: { isNew: false },
      },
    });

    // All Monday slots should be blocked
    expect(mondaySlots.slots.length).toBeGreaterThan(0);
    expect(mondaySlots.slots.every((slot) => slot.status === "BLOCKED")).toBe(
      true,
    );
    expect(
      mondaySlots.slots.every((slot) => slot.blockedByRuleId === ruleId),
    ).toBe(true);
  });

  test("DAY_OF_WEEK rule allows slots on Tuesday when Monday is blocked", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const generalTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "General",
      [practitionerId],
    );

    // Create base schedules for Monday and Tuesday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      1,
    ); // Monday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      2,
    ); // Tuesday

    // Create rule: Block Monday appointments only
    const conditionTree = {
      conditionType: "DAY_OF_WEEK" as const,
      nodeType: "CONDITION" as const,
      operator: "EQUALS" as const,
      valueNumber: 1,
    };

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Get slots for Tuesday
    const tuesdaySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-28", // Tuesday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: generalTypeId,
        patient: { isNew: false },
      },
    });

    // All Tuesday slots should be available
    expect(tuesdaySlots.slots.length).toBeGreaterThan(0);
    expect(
      tuesdaySlots.slots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);
  });

  test("APPOINTMENT_TYPE rule blocks slots for specific appointment type", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const surgeryTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Surgery",
      [practitionerId],
    );
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      1,
    ); // Monday

    // Create rule: Block "Surgery" appointments
    const conditionTree = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [surgeryTypeId],
    };

    // Expected behavior: "Wenn der Termintyp Surgery ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: surgeryTypeId, name: "Surgery" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    const ruleId = await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Get slots with Surgery appointment type
    const surgerySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        patient: { isNew: false },
      },
    });

    // All slots should be blocked for Surgery
    expect(surgerySlots.slots.length).toBeGreaterThan(0);
    expect(surgerySlots.slots.every((slot) => slot.status === "BLOCKED")).toBe(
      true,
    );
    expect(
      surgerySlots.slots.every((slot) => slot.blockedByRuleId === ruleId),
    ).toBe(true);

    // Test: Get slots with Checkup appointment type
    const checkupSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: checkupTypeId,
        patient: { isNew: false },
      },
    });

    // All slots should be available for Checkup
    expect(checkupSlots.slots.length).toBeGreaterThan(0);
    expect(
      checkupSlots.slots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);
  });

  test("PRACTITIONER rule blocks slots for specific practitioner only", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const generalTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "General",
      [drSmithId, drJonesId],
    );

    // Create schedules for both practitioners on Monday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drSmithId,
      locationId,
      1,
    );
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drJonesId,
      locationId,
      1,
    );

    // Create rule: Block Dr. Smith appointments
    const conditionTree = {
      conditionType: "PRACTITIONER" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [drSmithId],
    };

    // Expected behavior: "Wenn der Behandler Dr. Smith ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [{ _id: drSmithId, name: "Dr. Smith" }],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Get all slots for Monday
    const mondaySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: generalTypeId,
        patient: { isNew: false },
      },
    });

    // Should have slots from both practitioners
    expect(mondaySlots.slots.length).toBeGreaterThan(0);

    // Dr. Smith's slots should all be blocked
    const smithSlots = mondaySlots.slots.filter(
      (s) => s.practitionerId === drSmithId,
    );
    expect(smithSlots.length).toBeGreaterThan(0);
    expect(smithSlots.every((slot) => slot.status === "BLOCKED")).toBe(true);

    // Dr. Jones's slots should all be available
    const jonesSlots = mondaySlots.slots.filter(
      (s) => s.practitionerId === drJonesId,
    );
    expect(jonesSlots.length).toBeGreaterThan(0);
    expect(jonesSlots.every((slot) => slot.status === "AVAILABLE")).toBe(true);
  });

  test("Compound AND rule blocks slots only when both conditions match", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const surgeryTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Surgery",
      [practitionerId],
    );
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create schedules for Monday and Tuesday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      1,
    ); // Monday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      2,
    ); // Tuesday

    // Create rule: Block "Surgery" appointments on Monday
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [surgeryTypeId],
        },
        {
          conditionType: "DAY_OF_WEEK" as const,
          nodeType: "CONDITION" as const,
          operator: "EQUALS" as const,
          valueNumber: 1, // Monday
        },
      ],
      nodeType: "AND" as const,
    };

    // Expected behavior: "Wenn der Termintyp Surgery ist und es Montag ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: surgeryTypeId, name: "Surgery" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test 1: Surgery on Monday - should be blocked
    const mondaySurgerySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        patient: { isNew: false },
      },
    });

    expect(mondaySurgerySlots.slots.length).toBeGreaterThan(0);
    expect(
      mondaySurgerySlots.slots.every((slot) => slot.status === "BLOCKED"),
    ).toBe(true);

    // Test 2: Checkup on Monday - should be available (type doesn't match)
    const mondayCheckupSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: checkupTypeId,
        patient: { isNew: false },
      },
    });

    expect(mondayCheckupSlots.slots.length).toBeGreaterThan(0);
    expect(
      mondayCheckupSlots.slots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);

    // Test 3: Surgery on Tuesday - should be available (day doesn't match)
    const tuesdaySurgerySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-28", // Tuesday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        patient: { isNew: false },
      },
    });

    expect(tuesdaySurgerySlots.slots.length).toBeGreaterThan(0);
    expect(
      tuesdaySurgerySlots.slots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);
  });

  test("Complex nested AND rule with 3 conditions", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const mainOfficeId = await createLocation(
      t,
      practiceId,
      ruleSetId,
      "Main Office",
    );
    const branchId = await createLocation(t, practiceId, ruleSetId, "Branch");

    // Create appointment types
    const surgeryTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Surgery",
      [drSmithId, drJonesId],
    );
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [drSmithId, drJonesId],
    );

    // Create schedules for both practitioners at both locations on Monday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drSmithId,
      mainOfficeId,
      1,
    );
    await createBaseSchedule(t, practiceId, ruleSetId, drSmithId, branchId, 1);
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drJonesId,
      mainOfficeId,
      1,
    );

    // Create rule: Block "Surgery" with Dr. Smith at Main Office on Mondays
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [surgeryTypeId],
        },
        {
          conditionType: "PRACTITIONER" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [drSmithId],
        },
        {
          conditionType: "LOCATION" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [mainOfficeId],
        },
        {
          conditionType: "DAY_OF_WEEK" as const,
          nodeType: "CONDITION" as const,
          operator: "EQUALS" as const,
          valueNumber: 1, // Monday
        },
      ],
      nodeType: "AND" as const,
    };

    // Expected behavior: "Wenn der Termintyp Surgery ist und der Behandler Dr. Smith ist und der Standort Main Office ist und es Montag ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: surgeryTypeId, name: "Surgery" }],
      [{ _id: drSmithId, name: "Dr. Smith" }],
      [{ _id: mainOfficeId, name: "Main Office" }],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test 1: Surgery with Dr. Smith at Main Office on Monday - should be BLOCKED
    const blockedSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        locationId: mainOfficeId,
        patient: { isNew: false },
      },
    });

    const smithMainOfficeSlots = blockedSlots.slots.filter(
      (s) => s.practitionerId === drSmithId,
    );
    expect(smithMainOfficeSlots.length).toBeGreaterThan(0);
    expect(
      smithMainOfficeSlots.every((slot) => slot.status === "BLOCKED"),
    ).toBe(true);

    // Test 2: Surgery with Dr. Smith at Branch on Monday - should be AVAILABLE (location doesn't match)
    const smithBranchSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        locationId: branchId,
        patient: { isNew: false },
      },
    });

    const smithBranchSurgerySlots = smithBranchSlots.slots.filter(
      (s) => s.practitionerId === drSmithId,
    );
    expect(smithBranchSurgerySlots.length).toBeGreaterThan(0);
    expect(
      smithBranchSurgerySlots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);

    // Test 3: Surgery with Dr. Jones at Main Office on Monday - should be AVAILABLE (practitioner doesn't match)
    const jonesMainOfficeSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        locationId: mainOfficeId,
        patient: { isNew: false },
      },
    });

    const jonesSurgerySlots = jonesMainOfficeSlots.slots.filter(
      (s) => s.practitionerId === drJonesId,
    );
    expect(jonesSurgerySlots.length).toBeGreaterThan(0);
    expect(jonesSurgerySlots.every((slot) => slot.status === "AVAILABLE")).toBe(
      true,
    );

    // Test 4: Checkup with Dr. Smith at Main Office on Monday - should be AVAILABLE (appointment type doesn't match)
    const smithCheckupSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: checkupTypeId,
        locationId: mainOfficeId,
        patient: { isNew: false },
      },
    });

    const smithMainOfficeCheckupSlots = smithCheckupSlots.slots.filter(
      (s) => s.practitionerId === drSmithId,
    );
    expect(smithMainOfficeCheckupSlots.length).toBeGreaterThan(0);
    expect(
      smithMainOfficeCheckupSlots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);
  });

  test("DAYS_AHEAD rule blocks far-future slots", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const generalTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "General",
      [practitionerId],
    );

    // Create schedule for Mondays, Thursdays, and Fridays
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      1,
    ); // Monday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      4,
    ); // Thursday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      5,
    ); // Friday

    // Create rule: Block appointments >= 30 days ahead
    const conditionTree = {
      conditionType: "DAYS_AHEAD" as const,
      nodeType: "CONDITION" as const,
      operator: "GREATER_THAN_OR_EQUAL" as const,
      valueNumber: 30,
    };

    // Expected behavior: "Wenn der Termin 30 Tage oder mehr entfernt ist, darf der Termin nicht vergeben werden."
    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test 1: Slots 35 days ahead - should be blocked
    const farSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-11-28", // 35 days from Oct 24
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: generalTypeId,
        patient: { isNew: false },
        requestedAt: "2025-10-24T10:00:00.000Z", // Fixed request time for consistent test
      },
    });

    expect(farSlots.slots.length).toBeGreaterThan(0);
    expect(farSlots.slots.every((slot) => slot.status === "BLOCKED")).toBe(
      true,
    );

    // Test 2: Slots 20 days ahead - should be available
    const nearSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-11-13", // 20 days from Oct 24
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: generalTypeId,
        patient: { isNew: false },
        requestedAt: "2025-10-24T10:00:00.000Z", // Fixed request time for consistent test
      },
    });

    expect(nearSlots.slots.length).toBeGreaterThan(0);
    expect(nearSlots.slots.every((slot) => slot.status === "AVAILABLE")).toBe(
      true,
    );
  });

  test("Multiple rules - slot blocked if ANY rule matches", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const surgeryTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Surgery",
      [practitionerId],
    );
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create schedules for Monday and Tuesday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      1,
    ); // Monday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      2,
    ); // Tuesday

    // Rule 1: Block "Surgery" appointments
    const conditionTree1 = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS" as const,
      valueIds: [surgeryTypeId],
    };
    await createRule(t, practiceId, ruleSetId, conditionTree1);

    // Rule 2: Block Monday appointments
    const conditionTree2 = {
      conditionType: "DAY_OF_WEEK" as const,
      nodeType: "CONDITION" as const,
      operator: "EQUALS" as const,
      valueNumber: 1,
    };
    await createRule(t, practiceId, ruleSetId, conditionTree2);

    // Test 1: Surgery on Tuesday - blocked by rule 1
    const tuesdaySurgerySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-28", // Tuesday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        patient: { isNew: false },
      },
    });

    expect(tuesdaySurgerySlots.slots.length).toBeGreaterThan(0);
    expect(
      tuesdaySurgerySlots.slots.every((slot) => slot.status === "BLOCKED"),
    ).toBe(true);

    // Test 2: Checkup on Monday - blocked by rule 2
    const mondayCheckupSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: checkupTypeId,
        patient: { isNew: false },
      },
    });

    expect(mondayCheckupSlots.slots.length).toBeGreaterThan(0);
    expect(
      mondayCheckupSlots.slots.every((slot) => slot.status === "BLOCKED"),
    ).toBe(true);

    // Test 3: Surgery on Monday - blocked by BOTH rules
    const mondaySurgerySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        patient: { isNew: false },
      },
    });

    expect(mondaySurgerySlots.slots.length).toBeGreaterThan(0);
    expect(
      mondaySurgerySlots.slots.every((slot) => slot.status === "BLOCKED"),
    ).toBe(true);

    // Test 4: Checkup on Tuesday - available (no rules match)
    const tuesdayCheckupSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-28", // Tuesday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: checkupTypeId,
        patient: { isNew: false },
      },
    });

    expect(tuesdayCheckupSlots.slots.length).toBeGreaterThan(0);
    expect(
      tuesdayCheckupSlots.slots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);
  });

  test("IS_NOT operator - Block if appointment type is NOT Emergency", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const emergencyTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Emergency",
      [practitionerId],
    );
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create schedule for Monday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      1,
    );

    // Create rule: Block appointments that are NOT Emergency
    const conditionTree = {
      conditionType: "APPOINTMENT_TYPE" as const,
      nodeType: "CONDITION" as const,
      operator: "IS_NOT" as const,
      valueIds: [emergencyTypeId],
    };

    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: emergencyTypeId, name: "Emergency" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    const ruleId = await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Emergency appointments should be available
    const emergencySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: emergencyTypeId,
        patient: { isNew: false },
      },
    });

    expect(emergencySlots.slots.length).toBeGreaterThan(0);
    expect(
      emergencySlots.slots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);

    // Test: Non-emergency appointments should be blocked
    const checkupSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: checkupTypeId,
        patient: { isNew: false },
      },
    });

    expect(checkupSlots.slots.length).toBeGreaterThan(0);
    expect(checkupSlots.slots.every((slot) => slot.status === "BLOCKED")).toBe(
      true,
    );
    expect(
      checkupSlots.slots.every((slot) => slot.blockedByRuleId === ruleId),
    ).toBe(true);
  });

  test("Complex nested: Block Monday AND Dr. Smith AND location is NOT Main Office", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const mainOfficeId = await createLocation(
      t,
      practiceId,
      ruleSetId,
      "Main Office",
    );
    const branchId = await createLocation(
      t,
      practiceId,
      ruleSetId,
      "Branch Office",
    );

    // Create appointment type
    const generalTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "General",
      [drSmithId, drJonesId],
    );

    // Create schedules for Monday at both locations with both doctors
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drSmithId,
      mainOfficeId,
      1,
    );
    await createBaseSchedule(t, practiceId, ruleSetId, drSmithId, branchId, 1);
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drJonesId,
      mainOfficeId,
      1,
    );
    await createBaseSchedule(t, practiceId, ruleSetId, drJonesId, branchId, 1);

    // Create rule: Block if Monday AND Dr. Smith AND NOT Main Office
    const conditionTree = {
      children: [
        {
          conditionType: "DAY_OF_WEEK" as const,
          nodeType: "CONDITION" as const,
          operator: "EQUALS" as const,
          valueNumber: 1,
        },
        {
          conditionType: "PRACTITIONER" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [drSmithId],
        },
        {
          conditionType: "LOCATION" as const,
          nodeType: "CONDITION" as const,
          operator: "IS_NOT" as const,
          valueIds: [mainOfficeId],
        },
      ],
      nodeType: "AND" as const,
    };

    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [],
      [{ _id: drSmithId, name: "Dr. Smith" }],
      [{ _id: mainOfficeId, name: "Main Office" }],
    );
    console.log("Expected:", expectedRule);

    const ruleId = await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test 1: Monday + Dr. Smith + Branch Office = BLOCKED
    const blockedSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: generalTypeId,
        locationId: branchId,
        patient: { isNew: false },
      },
    });

    const smithBranchSlots = blockedSlots.slots.filter(
      (s) => s.practitionerId === drSmithId,
    );
    expect(smithBranchSlots.length).toBeGreaterThan(0);
    expect(smithBranchSlots.every((slot) => slot.status === "BLOCKED")).toBe(
      true,
    );
    expect(
      smithBranchSlots.every((slot) => slot.blockedByRuleId === ruleId),
    ).toBe(true);

    // Test 2: Monday + Dr. Smith + Main Office = AVAILABLE (location IS Main Office)
    const allowedSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: generalTypeId,
        locationId: mainOfficeId,
        patient: { isNew: false },
      },
    });

    const smithMainSlots = allowedSlots.slots.filter(
      (s) => s.practitionerId === drSmithId,
    );
    expect(smithMainSlots.length).toBeGreaterThan(0);
    expect(smithMainSlots.every((slot) => slot.status === "AVAILABLE")).toBe(
      true,
    );

    // Test 3: Monday + Dr. Jones + Branch Office = AVAILABLE (different practitioner)
    const jonesSlots = blockedSlots.slots.filter(
      (s) => s.practitionerId === drJonesId,
    );
    expect(jonesSlots.length).toBeGreaterThan(0);
    expect(jonesSlots.every((slot) => slot.status === "AVAILABLE")).toBe(true);
  });

  test("Complex nested: Block Surgery AND >14 days ahead AND 2+ concurrent appointments", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const surgeryTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Surgery",
      [drSmithId, drJonesId],
    );

    // Create schedules for both practitioners on Thursdays
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drSmithId,
      locationId,
      4,
    ); // Thursday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drJonesId,
      locationId,
      4,
    ); // Thursday

    // Create an existing Surgery appointment on Nov 13 at 10:00 Berlin time
    // This creates 1 concurrent Surgery appointment
    const existingAppointmentTime = Temporal.ZonedDateTime.from({
      day: 13,
      hour: 10,
      minute: 0,
      month: 11,
      timeZone: "Europe/Berlin",
      year: 2025,
    })
      .toInstant()
      .toString();

    await createAppointment(
      t,
      practiceId,
      drSmithId,
      locationId,
      surgeryTypeId,
      existingAppointmentTime,
    );

    // Create rule: Block if Surgery AND >= 14 days ahead AND >= 2 concurrent Surgery appointments
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [surgeryTypeId],
        },
        {
          conditionType: "DAYS_AHEAD" as const,
          nodeType: "CONDITION" as const,
          operator: "GREATER_THAN_OR_EQUAL" as const,
          valueNumber: 14,
        },
        {
          conditionType: "CONCURRENT_COUNT" as const,
          nodeType: "CONDITION" as const,
          operator: "GREATER_THAN_OR_EQUAL" as const,
          valueIds: ["practice", surgeryTypeId], // [scope, ...appointmentTypeIds]
          valueNumber: 2,
        },
      ],
      nodeType: "AND" as const,
    };

    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: surgeryTypeId, name: "Surgery" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test: Surgery 20 days ahead at 10:00 should be BLOCKED
    // (1 existing Surgery + 1 new = 2 concurrent, which meets >= 2 threshold)
    const surgerySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-11-13", // 20 days from Oct 24 (Thursday)
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        patient: { isNew: false },
        requestedAt: "2025-10-24T10:00:00.000Z",
      },
    });

    expect(surgerySlots.slots.length).toBeGreaterThan(0);

    // At 10:00 Berlin time, there's 1 existing Surgery appointment (also at 10:00 Berlin),
    // so adding another would make 2 total. This should be BLOCKED by the rule
    const expectedSlot10am = Temporal.ZonedDateTime.from({
      day: 13,
      hour: 10,
      minute: 0,
      month: 11,
      timeZone: "Europe/Berlin",
      year: 2025,
    })
      .toInstant()
      .toString();

    const slot10am = surgerySlots.slots.find(
      (slot) => slot.startTime === expectedSlot10am,
    );
    expect(slot10am).toBeDefined();
    expect(slot10am?.status).toBe("BLOCKED");

    // At 10:30 Berlin time, there's 0 existing appointments,
    // so adding 1 would make only 1 total. This should be AVAILABLE (doesn't meet >= 2 threshold)
    const expectedSlot1030am = Temporal.ZonedDateTime.from({
      day: 13,
      hour: 10,
      minute: 30,
      month: 11,
      timeZone: "Europe/Berlin",
      year: 2025,
    })
      .toInstant()
      .toString();

    const slot1030am = surgerySlots.slots.find(
      (slot) => slot.startTime === expectedSlot1030am,
    );
    expect(slot1030am).toBeDefined();
    expect(slot1030am?.status).toBe("AVAILABLE");
  });

  test("4-level nested AND: Block Surgery AND Monday AND Dr. Smith AND >7 days ahead", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const drSmithId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const drJonesId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Jones",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment type
    const surgeryTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Surgery",
      [drSmithId, drJonesId],
    );

    // Create schedules for next Monday (Oct 27) and following Monday (Nov 3)
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drSmithId,
      locationId,
      1,
    );
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      drJonesId,
      locationId,
      1,
    );

    // Create deeply nested rule
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS" as const,
          valueIds: [surgeryTypeId],
        },
        {
          children: [
            {
              conditionType: "DAY_OF_WEEK" as const,
              nodeType: "CONDITION" as const,
              operator: "EQUALS" as const,
              valueNumber: 1,
            },
            {
              children: [
                {
                  conditionType: "PRACTITIONER" as const,
                  nodeType: "CONDITION" as const,
                  operator: "IS" as const,
                  valueIds: [drSmithId],
                },
                {
                  conditionType: "DAYS_AHEAD" as const,
                  nodeType: "CONDITION" as const,
                  operator: "GREATER_THAN_OR_EQUAL" as const,
                  valueNumber: 7,
                },
              ],
              nodeType: "AND" as const,
            },
          ],
          nodeType: "AND" as const,
        },
      ],
      nodeType: "AND" as const,
    };

    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: surgeryTypeId, name: "Surgery" }],
      [{ _id: drSmithId, name: "Dr. Smith" }],
      [],
    );
    console.log("Expected:", expectedRule);

    const ruleId = await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test 1: Surgery + Monday Nov 3 (10 days ahead) + Dr. Smith = BLOCKED
    const blockedSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-11-03", // Monday, 10 days ahead
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        patient: { isNew: false },
        requestedAt: "2025-10-24T10:00:00.000Z", // Reference date
      },
    });

    const smithSlots = blockedSlots.slots.filter(
      (s) => s.practitionerId === drSmithId,
    );
    expect(smithSlots.length).toBeGreaterThan(0);
    expect(smithSlots.every((slot) => slot.status === "BLOCKED")).toBe(true);
    expect(smithSlots.every((slot) => slot.blockedByRuleId === ruleId)).toBe(
      true,
    );

    // Test 2: Same day/time but with Dr. Jones = AVAILABLE
    const jonesSlots = blockedSlots.slots.filter(
      (s) => s.practitionerId === drJonesId,
    );
    expect(jonesSlots.length).toBeGreaterThan(0);
    expect(jonesSlots.every((slot) => slot.status === "AVAILABLE")).toBe(true);

    // Test 3: Surgery + Monday Oct 27 (3 days ahead) + Dr. Smith = AVAILABLE (< 7 days)
    const nearSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday, only 3 days ahead
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: surgeryTypeId,
        patient: { isNew: false },
        requestedAt: "2025-10-24T10:00:00.000Z", // Reference date
      },
    });

    const smithNearSlots = nearSlots.slots.filter(
      (s) => s.practitionerId === drSmithId,
    );
    expect(smithNearSlots.length).toBeGreaterThan(0);
    expect(smithNearSlots.every((slot) => slot.status === "AVAILABLE")).toBe(
      true,
    );
  });

  test("Complex IS_NOT chain: Block if NOT Emergency AND NOT on Friday", async () => {
    const t = createTestContext();

    const practiceId = await createPractice(t);
    const ruleSetId = await createRuleSet(t, practiceId, true);
    const practitionerId = await createPractitioner(
      t,
      practiceId,
      ruleSetId,
      "Dr. Smith",
    );
    const locationId = await createLocation(t, practiceId, ruleSetId, "Office");

    // Create appointment types
    const emergencyTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Emergency",
      [practitionerId],
    );
    const checkupTypeId = await createAppointmentType(
      t,
      practiceId,
      ruleSetId,
      "Checkup",
      [practitionerId],
    );

    // Create schedules for Monday and Friday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      1,
    ); // Monday
    await createBaseSchedule(
      t,
      practiceId,
      ruleSetId,
      practitionerId,
      locationId,
      5,
    ); // Friday

    // Create rule: Block appointments that are NOT Emergency AND day is NOT Friday
    const conditionTree = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE" as const,
          nodeType: "CONDITION" as const,
          operator: "IS_NOT" as const,
          valueIds: [emergencyTypeId],
        },
        {
          conditionType: "DAY_OF_WEEK" as const,
          nodeType: "CONDITION" as const,
          operator: "IS_NOT" as const,
          valueNumber: 5, // NOT Friday
        },
      ],
      nodeType: "AND" as const,
    };

    const expectedRule = generateRuleName(
      conditionTreeToConditions(conditionTree),
      [{ _id: emergencyTypeId, name: "Emergency" }],
      [],
      [],
    );
    console.log("Expected:", expectedRule);

    const ruleId = await createRule(t, practiceId, ruleSetId, conditionTree);

    // Test 1: Checkup on Monday = BLOCKED (NOT Emergency AND NOT Friday)
    const mondayCheckupSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: checkupTypeId,
        patient: { isNew: false },
      },
    });

    expect(mondayCheckupSlots.slots.length).toBeGreaterThan(0);
    expect(
      mondayCheckupSlots.slots.every((slot) => slot.status === "BLOCKED"),
    ).toBe(true);
    expect(
      mondayCheckupSlots.slots.every((slot) => slot.blockedByRuleId === ruleId),
    ).toBe(true);

    // Test 2: Emergency on Monday = AVAILABLE (IS Emergency, even though NOT Friday)
    const mondayEmergencySlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-27", // Monday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: emergencyTypeId,
        patient: { isNew: false },
      },
    });

    expect(mondayEmergencySlots.slots.length).toBeGreaterThan(0);
    expect(
      mondayEmergencySlots.slots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);

    // Test 3: Checkup on Friday = AVAILABLE (IS Friday, even though NOT Emergency)
    const fridayCheckupSlots = await t.query(api.scheduling.getSlotsForDay, {
      date: "2025-10-31", // Friday
      practiceId,
      ruleSetId,
      simulatedContext: {
        appointmentTypeId: checkupTypeId,
        patient: { isNew: false },
      },
    });

    expect(fridayCheckupSlots.slots.length).toBeGreaterThan(0);
    expect(
      fridayCheckupSlots.slots.every((slot) => slot.status === "AVAILABLE"),
    ).toBe(true);
  });
});

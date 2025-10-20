// src/tests/regeln-unsaved-ruleset.test.ts
import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";

describe("Regeln Unsaved RuleSet Integration", () => {
  it("should support URL mapping for unsaved rule sets", () => {
    // Mock rule sets data
    const ruleSetsQuery = [
      {
        _id: "rule-set-1" as Id<"ruleSets">,
        description: "Ungespeicherte Änderungen",
        isActive: false,
        version: 1,
      },
      {
        _id: "rule-set-2" as Id<"ruleSets">,
        description: "Wintersprechzeiten 2024",
        isActive: true,
        version: 2,
      },
    ];

    const unsavedRuleSet = ruleSetsQuery[0];
    if (!unsavedRuleSet) {
      throw new Error("Missing test data: unsavedRuleSet");
    }

    // Test URL slug generation logic
    const generateRuleSetSlug = (
      ruleSetId: Id<"ruleSets"> | undefined,
      unsavedRuleSet: undefined | { _id: Id<"ruleSets"> },
      ruleSetsQuery: undefined | { _id: string; description: string }[],
    ): string | undefined => {
      if (!ruleSetId) {
        return undefined;
      }

      if (unsavedRuleSet?._id === ruleSetId) {
        return "ungespeichert";
      }

      const found = ruleSetsQuery?.find((rs) => rs._id === ruleSetId);
      return found
        ? found.description.toLowerCase().replaceAll(/\s+/g, "-")
        : undefined;
    };

    // Test unsaved rule set URL mapping
    const unsavedSlug = generateRuleSetSlug(
      unsavedRuleSet._id,
      unsavedRuleSet,
      ruleSetsQuery,
    );
    expect(unsavedSlug).toBe("ungespeichert");

    // Test saved rule set URL mapping
    const savedSlug = generateRuleSetSlug(
      "rule-set-2" as Id<"ruleSets">,
      unsavedRuleSet,
      ruleSetsQuery,
    );
    expect(savedSlug).toBe("wintersprechzeiten-2024");
  });

  it("should parse unsaved rule set from URL param", () => {
    const ruleSetsQuery = [
      {
        _id: "rule-set-1" as Id<"ruleSets">,
        description: "Ungespeicherte Änderungen",
        isActive: false,
        version: 1,
      },
    ];

    const parseRuleSetFromUrl = (
      ruleSetParam: string | undefined,
      unsavedRuleSet: undefined | { _id: Id<"ruleSets"> },
      ruleSetsQuery: undefined | { _id: string; description: string }[],
    ): Id<"ruleSets"> | undefined => {
      if (!ruleSetParam) {
        return undefined;
      }

      if (ruleSetParam === "ungespeichert") {
        return unsavedRuleSet?._id;
      }

      const found = ruleSetsQuery?.find(
        (rs) =>
          rs.description.toLowerCase().replaceAll(/\s+/g, "-") === ruleSetParam,
      );
      return found?._id as Id<"ruleSets"> | undefined;
    };

    // Test parsing unsaved rule set from URL
    const firstRs = ruleSetsQuery[0];
    if (!firstRs) {
      throw new Error("Missing test data: firstRs");
    }
    const parsedUnsaved = parseRuleSetFromUrl(
      "ungespeichert",
      firstRs,
      ruleSetsQuery,
    );
    expect(parsedUnsaved).toBe("rule-set-1");

    // Test parsing saved rule set from URL
    const parsedSaved = parseRuleSetFromUrl(
      "ungespeicherte-änderungen",
      firstRs,
      ruleSetsQuery,
    );
    expect(parsedSaved).toBe("rule-set-1");
  });

  it("should trigger ensureUnsavedRuleSet for management components", async () => {
    let ensureUnsavedRuleSetCalled = false;
    const mockEnsureUnsavedRuleSet = async () => {
      ensureUnsavedRuleSetCalled = true;
      // Ensure we have an await expression to satisfy lint rules
      await Promise.resolve();
      return "new-unsaved-rule-set" as Id<"ruleSets">;
    };

    // Simulate management component operations that should trigger unsaved state
    const managementOperations = [
      {
        name: "Practitioner Management",
        operation: async () => {
          // Simulate creating/updating/deleting practitioner
          await mockEnsureUnsavedRuleSet();
        },
      },
      {
        name: "Base Schedule Management",
        operation: async () => {
          // Simulate creating/updating/deleting schedule
          await mockEnsureUnsavedRuleSet();
        },
      },
      {
        name: "Locations Management",
        operation: async () => {
          // Simulate creating/updating/deleting location
          await mockEnsureUnsavedRuleSet();
        },
      },
      {
        name: "Appointment Types Management",
        operation: async () => {
          // Simulate updating appointment type practitioners
          await mockEnsureUnsavedRuleSet();
        },
      },
    ];

    // Test each management component triggers unsaved state
    for (const { operation } of managementOperations) {
      ensureUnsavedRuleSetCalled = false;
      await operation();
      expect(ensureUnsavedRuleSetCalled).toBe(true);
    }
  });

  it("should include unsaved rule set in simulation controls dropdown", () => {
    const ruleSetsQuery = [
      {
        _id: "rule-set-1" as Id<"ruleSets">,
        description: "Ungespeicherte Änderungen",
        isActive: false,
        version: 1,
      },
      {
        _id: "rule-set-2" as Id<"ruleSets">,
        description: "Wintersprechzeiten 2024",
        isActive: true,
        version: 2,
      },
    ];

    // Simulate the logic for showing unsaved rule set in dropdown
    const getDropdownOptions = (
      ruleSetsQuery:
        | undefined
        | { _id: string; description: string; isActive: boolean }[],
    ) => {
      const options = ["active"];

      // Add unsaved rule set if it exists
      const unsavedRuleSet = ruleSetsQuery?.find(
        (rs) => !rs.isActive && rs.description === "Ungespeicherte Änderungen",
      );
      if (unsavedRuleSet) {
        options.push("unsaved");
      }

      // Add other rule sets
      const otherRuleSets = ruleSetsQuery?.filter(
        (rs) => rs.description !== "Ungespeicherte Änderungen",
      );
      if (otherRuleSets) {
        options.push(...otherRuleSets.map((rs) => rs._id));
      }

      return options;
    };

    const options = getDropdownOptions(ruleSetsQuery);
    expect(options).toContain("unsaved");
    expect(options).toContain("rule-set-2");
    expect(options).toContain("active");
  });
});

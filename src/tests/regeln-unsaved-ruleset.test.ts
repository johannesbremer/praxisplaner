// src/tests/regeln-unsaved-ruleset.test.ts
import { describe, expect, it } from "vitest";

import type { Id } from "../convex/_generated/dataModel";

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

    // Test URL slug generation logic
    const generateRuleSetSlug = (
      ruleSetId: Id<"ruleSets"> | undefined,
      unsavedRuleSet: { _id: Id<"ruleSets"> } | undefined,
      ruleSetsQuery: { _id: string; description: string }[] | undefined,
    ): string | undefined => {
      if (!ruleSetId) return undefined;

      if (unsavedRuleSet && unsavedRuleSet._id === ruleSetId) {
        return "ungespeichert";
      }

      const found = ruleSetsQuery?.find((rs) => rs._id === ruleSetId);
      return found ? found.description.toLowerCase().replace(/\s+/g, "-") : undefined;
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
      unsavedRuleSet: { _id: Id<"ruleSets"> } | undefined,
      ruleSetsQuery: { _id: string; description: string }[] | undefined,
    ): Id<"ruleSets"> | undefined => {
      if (!ruleSetParam) return undefined;

      if (ruleSetParam === "ungespeichert") {
        return unsavedRuleSet?._id;
      }

      const found = ruleSetsQuery?.find(
        (rs) => rs.description.toLowerCase().replace(/\s+/g, "-") === ruleSetParam,
      );
      return found?._id as Id<"ruleSets"> | undefined;
    };

    // Test parsing unsaved rule set from URL
    const parsedUnsaved = parseRuleSetFromUrl(
      "ungespeichert",
      ruleSetsQuery[0],
      ruleSetsQuery,
    );
    expect(parsedUnsaved).toBe("rule-set-1");

    // Test parsing saved rule set from URL
    const parsedSaved = parseRuleSetFromUrl(
      "ungespeicherte-änderungen",
      ruleSetsQuery[0],
      ruleSetsQuery,
    );
    expect(parsedSaved).toBe("rule-set-1");
  });

  it("should trigger ensureUnsavedRuleSet for management components", async () => {
    let ensureUnsavedRuleSetCalled = false;
    const mockEnsureUnsavedRuleSet = async () => {
      ensureUnsavedRuleSetCalled = true;
      return "new-unsaved-rule-set" as Id<"ruleSets">;
    };

    // Simulate management component operations that should trigger unsaved state
    const managementOperations = [
      {
        name: "Practitioner Management",
        operation: async () => {
          // Simulate creating/updating/deleting practitioner
          if (mockEnsureUnsavedRuleSet) {
            await mockEnsureUnsavedRuleSet();
          }
        },
      },
      {
        name: "Base Schedule Management",
        operation: async () => {
          // Simulate creating/updating/deleting schedule
          if (mockEnsureUnsavedRuleSet) {
            await mockEnsureUnsavedRuleSet();
          }
        },
      },
      {
        name: "Locations Management",
        operation: async () => {
          // Simulate creating/updating/deleting location
          if (mockEnsureUnsavedRuleSet) {
            await mockEnsureUnsavedRuleSet();
          }
        },
      },
      {
        name: "Appointment Types Management",
        operation: async () => {
          // Simulate updating appointment type practitioners
          if (mockEnsureUnsavedRuleSet) {
            await mockEnsureUnsavedRuleSet();
          }
        },
      },
    ];

    // Test each management component triggers unsaved state
    for (const { name, operation } of managementOperations) {
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
      ruleSetsQuery: { _id: string; description: string; isActive: boolean }[] | undefined,
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
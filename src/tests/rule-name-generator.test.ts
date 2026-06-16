import { describe, expect, test } from "vitest";

import type { ConditionTreeNode } from "../../lib/condition-tree";

import {
  conditionTreeToConditions,
  generateRuleName,
} from "../../lib/rule-name-generator";

describe("rule-name-generator", () => {
  test("describes every backend condition type used by rule evaluation", () => {
    const conditionTree = {
      children: [
        {
          conditionType: "CLIENT_TYPE",
          nodeType: "CONDITION",
          operator: "IS",
          valueIds: ["Online"],
        },
        {
          conditionType: "DATE_RANGE",
          nodeType: "CONDITION",
          operator: "IS",
          valueIds: ["2026-01-02", "2026-01-09"],
        },
        {
          conditionType: "TIME_RANGE",
          nodeType: "CONDITION",
          operator: "IS_NOT",
          valueIds: ["08:00", "09:30"],
        },
      ],
      nodeType: "AND",
    } satisfies ConditionTreeNode;

    expect(
      generateRuleName(conditionTreeToConditions(conditionTree), [], [], []),
    ).toBe(
      "Wenn der Patiententyp Online ist, und das Datum zwischen 02.01.2026 und 09.01.2026 liegt, und die Uhrzeit nicht zwischen 08:00 und 09:30 liegt, darf der Termin nicht vergeben werden.",
    );
  });
});

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
        {
          conditionType: "MINIMUM_ADVANCE_TIME",
          nodeType: "CONDITION",
          operator: "LESS_THAN",
          valueIds: ["minutes"],
          valueNumber: 15,
        },
      ],
      nodeType: "AND",
    } satisfies ConditionTreeNode;

    expect(
      generateRuleName(conditionTreeToConditions(conditionTree), [], [], []),
    ).toBe(
      "Wenn der Patiententyp Online ist, und das Datum zwischen 02.01.2026 und 09.01.2026 liegt, und die Uhrzeit nicht zwischen 08:00 und 09:30 liegt, und der Termin nicht mindestens 15 Minuten in der Zukunft liegt, darf der Termin nicht vergeben werden.",
    );
  });

  test("refuses to flatten negated condition trees", () => {
    const conditionTree = {
      children: [
        {
          conditionType: "CLIENT_TYPE",
          nodeType: "CONDITION",
          operator: "IS",
          valueIds: ["Online"],
        },
      ],
      nodeType: "NOT",
    } satisfies ConditionTreeNode;

    expect(() => conditionTreeToConditions(conditionTree)).toThrow(
      "NOT-Regelbäume können nicht als flache Bedingungen dargestellt werden",
    );
  });
});

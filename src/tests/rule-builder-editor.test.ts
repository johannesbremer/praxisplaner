import { describe, expect, test } from "vitest";

import type { Condition } from "../components/rule-builder-types";

import { validateCondition } from "../components/rule-builder-editor";

describe("validateCondition", () => {
  test("rejects inverted date ranges", () => {
    const condition = {
      id: "date-range",
      operator: "IS",
      type: "DATE_RANGE",
      valueIds: ["2026-06-18", "2026-06-17"],
    } satisfies Condition;

    expect(validateCondition(condition)).toContain("rangeOrder");
  });

  test("allows same-day date ranges", () => {
    const condition = {
      id: "date-range",
      operator: "IS",
      type: "DATE_RANGE",
      valueIds: ["2026-06-17", "2026-06-17"],
    } satisfies Condition;

    expect(validateCondition(condition)).not.toContain("rangeOrder");
  });

  test("rejects empty and inverted time ranges", () => {
    const sameTimeCondition = {
      id: "same-time-range",
      operator: "IS",
      type: "TIME_RANGE",
      valueIds: ["09:00", "09:00"],
    } satisfies Condition;
    const invertedCondition = {
      id: "inverted-time-range",
      operator: "IS",
      type: "TIME_RANGE",
      valueIds: ["10:00", "09:00"],
    } satisfies Condition;

    expect(validateCondition(sameTimeCondition)).toContain("rangeOrder");
    expect(validateCondition(invertedCondition)).toContain("rangeOrder");
  });

  test("allows ascending time ranges", () => {
    const condition = {
      id: "time-range",
      operator: "IS",
      type: "TIME_RANGE",
      valueIds: ["09:00", "09:01"],
    } satisfies Condition;

    expect(validateCondition(condition)).not.toContain("rangeOrder");
  });

  test("requires a minimum advance amount and unit", () => {
    const condition = {
      id: "minimum-advance",
      operator: "LESS_THAN",
      type: "MINIMUM_ADVANCE_TIME",
      valueNumber: null,
    } satisfies Condition;

    expect(validateCondition(condition)).toEqual([
      "valueNumber",
      "advanceUnit",
    ]);
  });

  test("accepts minimum advance time with minutes", () => {
    const condition = {
      advanceUnit: "minutes",
      id: "minimum-advance",
      operator: "LESS_THAN",
      type: "MINIMUM_ADVANCE_TIME",
      valueNumber: 15,
    } satisfies Condition;

    expect(validateCondition(condition)).toEqual([]);
  });
});

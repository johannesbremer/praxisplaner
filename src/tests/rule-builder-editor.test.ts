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
});

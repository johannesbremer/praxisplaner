import { describe, expect, test } from "vitest";

import { normalizePracticePhoneNumber } from "../practicePhoneNumbers";

describe("practice phone numbers", () => {
  test("accepts E.164 practice numbers", () => {
    expect(normalizePracticePhoneNumber("+495421000000")).toBe("+495421000000");
  });

  test("rejects national-format practice numbers", () => {
    expect(() => normalizePracticePhoneNumber("05421 000000")).toThrow(
      "Practice phone number must be provided in E.164 format",
    );
  });

  test("rejects spaced international practice numbers", () => {
    expect(() => normalizePracticePhoneNumber("+49 5421 000000")).toThrow(
      "Practice phone number must be provided in E.164 format",
    );
  });
});

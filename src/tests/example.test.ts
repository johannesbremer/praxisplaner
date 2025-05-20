import { describe, expect, test } from "vitest";

describe("Example Suite", () => {
  test("should pass", () => {
    expect(1 + 1).toBe(2);
  });

  test("another passing test", () => {
    expect(true).toBe(true);
  });
});

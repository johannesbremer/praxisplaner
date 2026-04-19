import { describe, expect, it } from "vitest";

import { asDateRangeInput } from "../../convex/typedDtos";

describe("Date Range Input", () => {
  it("keeps ISO instant input compatible with Date parsing", () => {
    const dateRange = asDateRangeInput({
      end: "2026-04-19T23:59:59.999Z",
      start: "2026-04-19T00:00:00.000Z",
    });

    expect(dateRange.start).toBe("2026-04-19T00:00:00Z");
    expect(dateRange.end).toBe("2026-04-19T23:59:59.999Z");
    expect(Number.isNaN(new Date(dateRange.start).getTime())).toBe(false);
    expect(Number.isNaN(new Date(dateRange.end).getTime())).toBe(false);
  });
});

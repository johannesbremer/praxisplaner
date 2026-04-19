import { describe, expect, it } from "vitest";

import {
  asDateRangeInput,
  asSimulatedContextInput,
} from "../../convex/typedDtos";

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

  it("accepts instant requestedAt values for simulated scheduling context", () => {
    const simulatedContext = asSimulatedContextInput({
      patient: {
        dateOfBirth: "1980-01-01",
        isNew: false,
      },
      requestedAt: "2026-04-19T12:34:56.000Z",
    });

    expect(simulatedContext.requestedAt).toBe("2026-04-19T12:34:56Z");
    expect(simulatedContext.patient.dateOfBirth).toBe("1980-01-01");
  });

  it("rejects non-ISO patient birth dates outside GDT ingestion", () => {
    expect(() =>
      asSimulatedContextInput({
        patient: {
          dateOfBirth: "01011980",
          isNew: false,
        },
      }),
    ).toThrow('Expected YYYY-MM-DD date string, got "01011980".');
  });
});

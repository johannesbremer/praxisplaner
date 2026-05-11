import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";

import { formatDateDE, parseDateDE } from "../utils/date-utils";
import { assertProperty } from "./property-test-utils";

describe("German date formatting properties", () => {
  test("formatDateDE and parseDateDE round-trip valid PlainDate values", () => {
    assertProperty(
      fc.property(fc.integer({ max: 36_890, min: 0 }), (daysSinceStart) => {
        const date = Temporal.PlainDate.from("2000-01-01").add({
          days: daysSinceStart,
        });

        const parsed = parseDateDE(formatDateDE(date));
        expect(parsed.ok).toBe(true);
        expect(parsed.ok ? parsed.value.equals(date) : false).toBe(true);
      }),
      "date German format round-trip",
    );
  });
});

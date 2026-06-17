import { describe, expect, test } from "vitest";

import { normalizeAppointmentSmileyOptions } from "../../convex/practices";

describe("appointment smiley options", () => {
  test("rejects duplicate emojis instead of silently dropping later rows", () => {
    expect(() =>
      normalizeAppointmentSmileyOptions([
        { emoji: "👍", name: "Patient ist angekommen" },
        { emoji: "👍", name: "Patient wartet" },
      ]),
    ).toThrow("Jedes Termin-Smiley darf nur einmal vorkommen.");
  });
});

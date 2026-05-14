import { describe, expect, test } from "vitest";

import { toTableId } from "../../convex/identity";
import { buildTelefonkiInstructions } from "./instructions";

describe("TelefonKI instructions", () => {
  test("uses dynamic Convex choices instead of legacy hardcoded IDs", () => {
    const instructions = buildTelefonkiInstructions({
      appointmentTypes: [
        {
          duration: 15,
          lineageKey: toTableId<"appointmentTypes">("appointmentTypes_dynamic"),
          name: "Akutsprechstunde",
        },
      ],
      locations: [
        {
          lineageKey: toTableId<"locations">("locations_dynamic"),
          name: "Dynamischer Standort",
        },
      ],
      practitioners: [
        {
          lineageKey: toTableId<"practitioners">("practitioners_dynamic"),
          name: "Dr. Dynamisch",
          tags: [],
        },
      ],
      ruleSetId: toTableId<"ruleSets">("ruleSets_dynamic"),
    });

    expect(instructions).toContain("appointmentTypes_dynamic");
    expect(instructions).toContain("locations_dynamic");
    expect(instructions).toContain("practitioners_dynamic");
    expect(instructions).toContain("telefonnummer_speichern");
    expect(instructions).toContain("offerId");
    expect(instructions).toContain("nicht mehr frei");
    expect(instructions).toContain("unknown");
    expect(instructions).toContain("auch wenn sie unknown ist");
    expect(instructions).not.toContain("mx41grkuwysmzha");
    expect(instructions).not.toContain("nmgcj70h2l4rxbd");
    expect(instructions).not.toContain("lteonvjyshdvfh6");
    expect(instructions).not.toContain("p1zgantglzc1gv2");
  });
});

import { describe, expect, test } from "vitest";

import {
  buildOfferedSlotId,
  formatTelefonkiDate,
  formatTelefonkiDateTime,
  listMissingBookingPrerequisites,
  renderOfferedSlots,
  sanitizePhoneNumber,
} from "./agent-state";

describe("TelefonKI agent state helpers", () => {
  test("renders unique offer ids for slots with the same start time", () => {
    const store = new Map<
      string,
      {
        locationLineageKey: string;
        practitionerLineageKey: string;
        practitionerName: string;
        startTime: string;
      }
    >();
    const firstSlot = {
      locationLineageKey: "locations_a",
      practitionerLineageKey: "practitioners_a",
      practitionerName: "Dr. A",
      startTime: "2026-05-11T09:00:00+02:00[Europe/Berlin]",
    };
    const secondSlot = {
      locationLineageKey: "locations_a",
      practitionerLineageKey: "practitioners_b",
      practitionerName: "Dr. B",
      startTime: "2026-05-11T09:00:00+02:00[Europe/Berlin]",
    };
    const slots = [firstSlot, secondSlot];

    const response = renderOfferedSlots({
      formatSlot: (slot) => `${slot.startTime} bei ${slot.practitionerName}`,
      slots,
      store,
    });

    const firstOfferId = buildOfferedSlotId(firstSlot);
    const secondOfferId = buildOfferedSlotId(secondSlot);

    expect(firstOfferId).not.toBe(secondOfferId);
    expect(store.get(firstOfferId)?.practitionerName).toBe("Dr. A");
    expect(store.get(secondOfferId)?.practitionerName).toBe("Dr. B");
    expect(response).toContain(`offerId: ${firstOfferId}`);
    expect(response).toContain(`offerId: ${secondOfferId}`);
  });

  test("requires a phone number when caller id is unavailable", () => {
    const missing = listMissingBookingPrerequisites({
      appointmentType: { id: "appointmentType" },
      birthDate: "1980-01-01",
      firstName: "Ada",
      isNewPatient: false,
      lastName: "Lovelace",
      location: { id: "location" },
      reason: "Rueckenschmerzen",
    });

    expect(missing).toContain("Telefonnummer");
  });

  test("sanitizes a provided phone number", () => {
    expect(sanitizePhoneNumber("  +491701234567  ")).toBe("+491701234567");
    expect(() => sanitizePhoneNumber("   ")).toThrow(
      "Telefonnummer darf nicht leer sein.",
    );
  });

  test("formats Temporal zoned slot strings without using Date parsing", () => {
    const formatted = formatTelefonkiDateTime(
      "2026-05-11T09:00:00+02:00[Europe/Berlin]",
    );

    expect(formatted).not.toContain("Invalid Date");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("09:00");
  });

  test("formats stored birth dates through Temporal", () => {
    const formatted = formatTelefonkiDate("1980-01-01");

    expect(formatted).not.toContain("Invalid Date");
    expect(formatted).toContain("1980");
  });
});

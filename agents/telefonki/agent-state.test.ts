import { describe, expect, test } from "vitest";

import {
  buildOfferedSlotId,
  buildTelefonkiOfferCriteria,
  clearOfferedSlots,
  formatTelefonkiDate,
  formatTelefonkiDateTime,
  isStoredOfferCompatible,
  listMissingBookingPrerequisites,
  renderOfferedSlots,
  sanitizePhoneNumber,
  type StoredTelefonkiOffer,
} from "./agent-state";

describe("TelefonKI agent state helpers", () => {
  test("renders unique offer ids for slots with the same start time", () => {
    const store = new Map<
      string,
      StoredTelefonkiOffer<{
        locationLineageKey: string;
        practitionerLineageKey: string;
        practitionerName: string;
        startTime: string;
      }>
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
      criteria: buildTelefonkiOfferCriteria({
        appointmentTypeLineageKey: "appointmentType_a",
        birthDate: "1980-01-01",
        isNewPatient: false,
        locationLineageKey: "locations_a",
      }),
      formatSlot: (slot) => `${slot.startTime} bei ${slot.practitionerName}`,
      slots,
      store,
    });

    const firstOfferId = buildOfferedSlotId(firstSlot);
    const secondOfferId = buildOfferedSlotId(secondSlot);

    expect(firstOfferId).not.toBe(secondOfferId);
    expect(store.get(firstOfferId)?.slot.practitionerName).toBe("Dr. A");
    expect(store.get(secondOfferId)?.slot.practitionerName).toBe("Dr. B");
    expect(response).toContain(`offerId: ${firstOfferId}`);
    expect(response).toContain(`offerId: ${secondOfferId}`);
  });

  test("invalidates stored offers when criteria change", () => {
    const originalCriteria = buildTelefonkiOfferCriteria({
      appointmentTypeLineageKey: "appointmentType_a",
      birthDate: "1980-01-01",
      isNewPatient: false,
      locationLineageKey: "locations_a",
      practitionerLineageKey: "practitioners_a",
    });
    const changedCriteria = buildTelefonkiOfferCriteria({
      appointmentTypeLineageKey: "appointmentType_b",
      birthDate: "1980-01-01",
      isNewPatient: false,
      locationLineageKey: "locations_a",
      practitionerLineageKey: "practitioners_a",
    });

    expect(isStoredOfferCompatible(originalCriteria, originalCriteria)).toBe(
      true,
    );
    expect(isStoredOfferCompatible(changedCriteria, originalCriteria)).toBe(
      false,
    );
  });

  test("clears offered slots explicitly", () => {
    const store = new Map([
      [
        "offer-1",
        {
          criteria: buildTelefonkiOfferCriteria({
            appointmentTypeLineageKey: "appointmentType_a",
            isNewPatient: false,
            locationLineageKey: "locations_a",
          }),
          slot: {
            locationLineageKey: "locations_a",
            practitionerLineageKey: "practitioners_a",
            practitionerName: "Dr. A",
            startTime: "2026-05-11T09:00:00+02:00[Europe/Berlin]",
          },
        },
      ],
    ]);

    clearOfferedSlots(store);

    expect(store.size).toBe(0);
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
    expect(() => sanitizePhoneNumber("01701234567")).toThrow(
      "Telefonnummer muss im E.164-Format angegeben werden",
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

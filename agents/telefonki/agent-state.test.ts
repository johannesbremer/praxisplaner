import { describe, expect, test } from "vitest";

import {
  type ActiveTelefonkiOffers,
  advanceSearchVersion,
  buildOfferedSlotId,
  buildTelefonkiOfferCriteria,
  clearOfferedSlots,
  formatTelefonkiDate,
  formatTelefonkiDateTime,
  isStoredOfferCompatible,
  listMissingBookingPrerequisites,
  renderOfferedSlots,
  sanitizePhoneNumber,
  TELEFONKI_OFFER_TTL_MS,
} from "./agent-state";

interface TestSlot {
  locationLineageKey: string;
  practitionerLineageKey: string;
  practitionerName: string;
  startTime: string;
}

function createActiveOffers(): ActiveTelefonkiOffers<TestSlot> {
  return {
    generatedAt: undefined,
    offers: new Map(),
    searchRequest: undefined,
    searchVersion: 0,
  };
}

function createTestSlot(
  practitionerLineageKey: string,
  practitionerName: string,
): TestSlot {
  return {
    locationLineageKey: "locations_a",
    practitionerLineageKey,
    practitionerName,
    startTime: "2026-05-11T09:00:00+02:00[Europe/Berlin]",
  };
}

describe("TelefonKI agent state helpers", () => {
  test("renders unique offer ids for slots with the same start time", () => {
    const activeOffers = createActiveOffers();
    const firstSlot = createTestSlot("practitioners_a", "Dr. A");
    const secondSlot = createTestSlot("practitioners_b", "Dr. B");

    const response = renderOfferedSlots({
      activeOffers,
      criteria: buildTelefonkiOfferCriteria({
        appointmentTypeLineageKey: "appointmentType_a",
        birthDate: "1980-01-01",
        insuranceStatus: "public",
        isNewPatient: false,
        locationLineageKey: "locations_a",
      }),
      formatSlot: (slot) => `${slot.startTime} bei ${slot.practitionerName}`,
      searchRequest: {
        kind: "nextAvailableSlots",
        limit: 10,
      },
      slots: [firstSlot, secondSlot],
    });

    const firstOfferId = buildOfferedSlotId(firstSlot);
    const secondOfferId = buildOfferedSlotId(secondSlot);

    expect(firstOfferId).not.toBe(secondOfferId);
    expect(activeOffers.offers.get(firstOfferId)?.slot.practitionerName).toBe(
      "Dr. A",
    );
    expect(activeOffers.offers.get(secondOfferId)?.slot.practitionerName).toBe(
      "Dr. B",
    );
    expect(activeOffers.searchRequest).toEqual({
      kind: "nextAvailableSlots",
      limit: 10,
    });
    expect(response).toContain(`offerId: ${firstOfferId}`);
    expect(response).toContain(`offerId: ${secondOfferId}`);
  });

  test("invalidates stored offers when criteria change", () => {
    const activeOffers = createActiveOffers();
    const originalCriteria = buildTelefonkiOfferCriteria({
      appointmentTypeLineageKey: "appointmentType_a",
      birthDate: "1980-01-01",
      insuranceStatus: "public",
      isNewPatient: false,
      locationLineageKey: "locations_a",
      practitionerLineageKey: "practitioners_a",
    });
    const changedCriteria = buildTelefonkiOfferCriteria({
      appointmentTypeLineageKey: "appointmentType_b",
      birthDate: "1980-01-01",
      insuranceStatus: "public",
      isNewPatient: false,
      locationLineageKey: "locations_a",
      practitionerLineageKey: "practitioners_a",
    });

    renderOfferedSlots({
      activeOffers,
      criteria: originalCriteria,
      formatSlot: (slot) => `${slot.startTime} bei ${slot.practitionerName}`,
      now: 100,
      searchRequest: {
        kind: "nextAvailableSlot",
      },
      slots: [createTestSlot("practitioners_a", "Dr. A")],
    });

    const storedOffer = activeOffers.offers.values().next().value;
    if (!storedOffer) {
      throw new Error("Expected a stored offer.");
    }

    expect(
      isStoredOfferCompatible({
        activeOffers,
        currentCriteria: originalCriteria,
        now: 101,
        storedOffer,
      }),
    ).toBeNull();
    expect(
      isStoredOfferCompatible({
        activeOffers,
        currentCriteria: changedCriteria,
        now: 101,
        storedOffer,
      }),
    ).toBe("criteria_changed");
  });

  test("search version changes invalidate old offers", () => {
    const activeOffers = createActiveOffers();
    const criteria = buildTelefonkiOfferCriteria({
      appointmentTypeLineageKey: "appointmentType_a",
      insuranceStatus: "public",
      isNewPatient: false,
      locationLineageKey: "locations_a",
    });

    renderOfferedSlots({
      activeOffers,
      criteria,
      formatSlot: (slot) => `${slot.startTime} bei ${slot.practitionerName}`,
      now: 100,
      searchRequest: {
        kind: "nextAvailableSlot",
      },
      slots: [createTestSlot("practitioners_a", "Dr. A")],
    });

    const storedOffer = activeOffers.offers.values().next().value;
    if (!storedOffer) {
      throw new Error("Expected a stored offer.");
    }

    advanceSearchVersion(activeOffers);

    expect(activeOffers.searchVersion).toBe(1);
    expect(activeOffers.offers.size).toBe(0);
    expect(
      isStoredOfferCompatible({
        activeOffers,
        currentCriteria: criteria,
        now: 101,
        storedOffer,
      }),
    ).toBe("stale_version");
  });

  test("clears offered slots explicitly", () => {
    const activeOffers = createActiveOffers();

    renderOfferedSlots({
      activeOffers,
      criteria: buildTelefonkiOfferCriteria({
        appointmentTypeLineageKey: "appointmentType_a",
        insuranceStatus: "public",
        isNewPatient: false,
        locationLineageKey: "locations_a",
      }),
      formatSlot: (slot) => `${slot.startTime} bei ${slot.practitionerName}`,
      now: 100,
      searchRequest: {
        kind: "nextAvailableSlot",
      },
      slots: [createTestSlot("practitioners_a", "Dr. A")],
    });

    clearOfferedSlots(activeOffers);

    expect(activeOffers.generatedAt).toBeUndefined();
    expect(activeOffers.offers.size).toBe(0);
    expect(activeOffers.searchRequest).toBeUndefined();
  });

  test("expires stale offers after the ttl", () => {
    const activeOffers = createActiveOffers();
    const criteria = buildTelefonkiOfferCriteria({
      appointmentTypeLineageKey: "appointmentType_a",
      insuranceStatus: "public",
      isNewPatient: false,
      locationLineageKey: "locations_a",
    });

    renderOfferedSlots({
      activeOffers,
      criteria,
      formatSlot: (slot) => `${slot.startTime} bei ${slot.practitionerName}`,
      now: 100,
      searchRequest: {
        date: "2026-05-11",
        kind: "availableSlotsOnDate",
        limit: 10,
      },
      slots: [createTestSlot("practitioners_a", "Dr. A")],
    });

    const storedOffer = activeOffers.offers.values().next().value;
    if (!storedOffer) {
      throw new Error("Expected a stored offer.");
    }

    expect(
      isStoredOfferCompatible({
        activeOffers,
        currentCriteria: criteria,
        now: 100 + TELEFONKI_OFFER_TTL_MS + 1,
        storedOffer,
      }),
    ).toBe("expired");
  });

  test("requires a phone number when caller id is unavailable", () => {
    const missing = listMissingBookingPrerequisites({
      appointmentType: { id: "appointmentType" },
      birthDate: "1980-01-01",
      firstName: "Ada",
      insuranceStatus: "public",
      isNewPatient: false,
      lastName: "Lovelace",
      location: { id: "location" },
      reason: "Rueckenschmerzen",
    });

    expect(missing).toContain("Behandler");
    expect(missing).toContain("Telefonnummer");
  });

  test("accepts an explicit unknown practitioner selection as complete", () => {
    const missing = listMissingBookingPrerequisites({
      appointmentType: { id: "appointmentType" },
      birthDate: "1980-01-01",
      firstName: "Ada",
      insuranceStatus: "public",
      isNewPatient: false,
      lastName: "Lovelace",
      location: { id: "location" },
      phoneNumber: "+491701234567",
      practitionerSelection: { kind: "unknown" },
      reason: "Rueckenschmerzen",
    });

    expect(missing).not.toContain("Behandler");
  });

  test("sanitizes a provided phone number", () => {
    expect(sanitizePhoneNumber("  +491701234567  ")).toBe("+491701234567");
    expect(() => sanitizePhoneNumber(" ".repeat(3))).toThrow(
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

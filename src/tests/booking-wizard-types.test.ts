import { describe, expect, it } from "vitest";

import type { BookingSessionState } from "../components/booking-wizard/types";

import {
  canGoBack,
  getStepGroup,
  STEP_LABELS,
} from "../components/booking-wizard/types";

const ALL_STEPS = Object.keys(STEP_LABELS) as BookingSessionState["step"][];

describe("STEP_LABELS", () => {
  it("has a label for every step", () => {
    for (const step of ALL_STEPS) {
      expect(STEP_LABELS[step]).toBeDefined();
      expect(typeof STEP_LABELS[step]).toBe("string");
      expect(STEP_LABELS[step].length).toBeGreaterThan(0);
    }
  });

  it("contains expected labels for key steps", () => {
    expect(STEP_LABELS.privacy).toBe("Datenschutz");
    expect(STEP_LABELS["patient-status"]).toBe("Patientenstatus");
    expect(STEP_LABELS["new-confirmation"]).toBe("Bestätigung");
    expect(STEP_LABELS["existing-confirmation"]).toBe("Bestätigung");
  });
});

describe("getStepGroup", () => {
  describe("info group", () => {
    const infoSteps: BookingSessionState["step"][] = [
      "existing-appointment-type",
      "existing-data-input",
      "existing-doctor-selection",
      "new-age-check",
      "new-appointment-type",
      "new-data-input",
      "new-gkv-details",
      "new-insurance-type",
      "new-pkv-details",
      "patient-status",
    ];

    it.each(infoSteps)('returns "info" for step "%s"', (step) => {
      expect(getStepGroup(step)).toBe("info");
    });
  });

  describe("booking group", () => {
    const bookingSteps: BookingSessionState["step"][] = [
      "existing-calendar-selection",
      "new-calendar-selection",
    ];

    it.each(bookingSteps)('returns "booking" for step "%s"', (step) => {
      expect(getStepGroup(step)).toBe("booking");
    });
  });

  describe("confirmation group", () => {
    const confirmationSteps: BookingSessionState["step"][] = [
      "existing-confirmation",
      "new-confirmation",
    ];

    it.each(confirmationSteps)(
      'returns "confirmation" for step "%s"',
      (step) => {
        expect(getStepGroup(step)).toBe("confirmation");
      },
    );
  });

  describe("consent group", () => {
    const consentSteps: BookingSessionState["step"][] = [
      "location",
      "new-pvs-consent",
      "privacy",
    ];

    it.each(consentSteps)('returns "consent" for step "%s"', (step) => {
      expect(getStepGroup(step)).toBe("consent");
    });
  });

  it("returns a valid group for all known steps", () => {
    const validGroups = ["booking", "confirmation", "consent", "info"];

    for (const step of ALL_STEPS) {
      const group = getStepGroup(step);
      expect(validGroups).toContain(group);
    }
  });
});

describe("canGoBack", () => {
  describe("existing patient flow", () => {
    it("cannot go back from existing-appointment-type (after doctor selection)", () => {
      expect(canGoBack("existing-appointment-type")).toBe(false);
    });

    it("cannot go back from existing-calendar-selection", () => {
      expect(canGoBack("existing-calendar-selection")).toBe(false);
    });

    it("cannot go back from existing-confirmation", () => {
      expect(canGoBack("existing-confirmation")).toBe(false);
    });

    it("cannot go back from existing-data-input", () => {
      expect(canGoBack("existing-data-input")).toBe(false);
    });

    it("can go back from existing-doctor-selection", () => {
      expect(canGoBack("existing-doctor-selection")).toBe(true);
    });
  });

  describe("new patient flow", () => {
    it("cannot go back from new-confirmation", () => {
      expect(canGoBack("new-confirmation")).toBe(false);
    });

    it("can go back from new-appointment-type", () => {
      expect(canGoBack("new-appointment-type")).toBe(true);
    });

    it("can go back from new-calendar-selection", () => {
      expect(canGoBack("new-calendar-selection")).toBe(true);
    });

    it("can go back from new-data-input", () => {
      expect(canGoBack("new-data-input")).toBe(true);
    });

    it("can go back from new-gkv-details", () => {
      expect(canGoBack("new-gkv-details")).toBe(true);
    });

    it("can go back from new-insurance-type", () => {
      expect(canGoBack("new-insurance-type")).toBe(true);
    });

    it("can go back from new-pkv-details", () => {
      expect(canGoBack("new-pkv-details")).toBe(true);
    });

    it("can go back from new-pvs-consent", () => {
      expect(canGoBack("new-pvs-consent")).toBe(true);
    });

    it("can go back from new-age-check", () => {
      expect(canGoBack("new-age-check")).toBe(true);
    });
  });

  describe("shared steps", () => {
    it("cannot go back from privacy (first step)", () => {
      expect(canGoBack("privacy")).toBe(false);
    });

    it("can go back from patient-status", () => {
      expect(canGoBack("patient-status")).toBe(true);
    });

    it("can go back from location", () => {
      expect(canGoBack("location")).toBe(true);
    });
  });

  it("returns a boolean for all known steps", () => {
    for (const step of ALL_STEPS) {
      const result = canGoBack(step);
      expect(typeof result).toBe("boolean");
    }
  });
});

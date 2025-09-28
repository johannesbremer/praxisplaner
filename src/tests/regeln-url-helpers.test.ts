import { describe, expect, it } from "vitest";

import {
  buildRegelnSearchFromState,
  EXISTING_PATIENT_SEGMENT,
  NEW_PATIENT_SEGMENT,
} from "../utils/regeln-url";

describe("Regeln search helpers", () => {
  it("builds search params only for defined state", () => {
    const search = buildRegelnSearchFromState({
      dateYmd: "2025-01-30",
      locationSlug: "praxis-am-markt",
      patientTypeSegment: EXISTING_PATIENT_SEGMENT,
      ruleSetSlug: "wintersprechzeiten-2025",
      tabParam: "debug",
    });

    expect(search).toEqual({
      datum: "2025-01-30",
      location: "praxis-am-markt",
      patientType: EXISTING_PATIENT_SEGMENT,
      regelwerk: "wintersprechzeiten-2025",
      tab: "debug",
    });
  });

  it("omits undefined values", () => {
    const search = buildRegelnSearchFromState({
      dateYmd: undefined,
      locationSlug: undefined,
      patientTypeSegment: NEW_PATIENT_SEGMENT,
      ruleSetSlug: undefined,
      tabParam: undefined,
    });

    expect(search).toEqual({
      patientType: NEW_PATIENT_SEGMENT,
    });
    expect(Object.hasOwn(search, "datum")).toBe(false);
    expect(Object.hasOwn(search, "location")).toBe(false);
    expect(Object.hasOwn(search, "regelwerk")).toBe(false);
    expect(Object.hasOwn(search, "tab")).toBe(false);
  });
});

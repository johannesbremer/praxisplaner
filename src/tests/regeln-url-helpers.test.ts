import { describe, expect, it } from "vitest";

import {
  buildRegelnSearchFromState,
  EXISTING_PATIENT_SEGMENT,
  NEW_PATIENT_SEGMENT,
} from "../utils/regeln-url";

describe("Regeln search helpers", () => {
  it("builds search params only for defined state", () => {
    const search = buildRegelnSearchFromState({
      dateDE: "30.01.2025",
      locationName: "Praxis am Markt",
      patientTypeSegment: EXISTING_PATIENT_SEGMENT,
      ruleSetId: "wintersprechzeiten-2025",
      tabParam: "debug",
    });

    expect(search).toEqual({
      datum: "30.01.2025",
      patientType: EXISTING_PATIENT_SEGMENT,
      regelwerk: "wintersprechzeiten-2025",
      standort: "Praxis am Markt",
      tab: "debug",
    });
  });

  it("omits undefined values", () => {
    const search = buildRegelnSearchFromState({
      dateDE: undefined,
      locationName: undefined,
      patientTypeSegment: NEW_PATIENT_SEGMENT,
      ruleSetId: undefined,
      tabParam: undefined,
    });

    expect(Object.hasOwn(search, "datum")).toBe(false);
    expect(Object.hasOwn(search, "standort")).toBe(false);
    expect(Object.hasOwn(search, "regelwerk")).toBe(false);
    expect(Object.hasOwn(search, "tab")).toBe(false);

    expect(search).toEqual({
      patientType: NEW_PATIENT_SEGMENT,
    });
  });
});

import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { DeDateString } from "../../lib/typed-regex";

import {
  buildRegelnSearchFromState,
  EXISTING_PATIENT_SEGMENT,
  NEW_PATIENT_SEGMENT,
  type RegelnTabParam,
} from "../utils/regeln-url";
import { assertProperty } from "./property-test-utils";

describe("Regeln search normalization properties", () => {
  test("buildRegelnSearchFromState omits undefined fields and preserves explicit URL state", () => {
    assertProperty(
      fc.property(
        fc.option(
          fc.constantFrom<RegelnTabParam>("debug", "mitarbeiter", "urlaub"),
          {
            nil: undefined,
          },
        ),
        fc.option(
          fc.constantFrom(EXISTING_PATIENT_SEGMENT, NEW_PATIENT_SEGMENT),
          {
            nil: undefined,
          },
        ),
        fc.option(fc.string({ maxLength: 16, minLength: 1 }), {
          nil: undefined,
        }),
        (tabParam, patientTypeSegment, locationName) => {
          const dateDE = "15.06.2026" as DeDateString;
          const search = buildRegelnSearchFromState({
            dateDE,
            locationName,
            patientTypeSegment,
            ruleSetDescription: undefined,
            tabParam,
          });

          expect(search.datum).toBe(dateDE);
          expect(search.regelwerk).toBeUndefined();
          expect(search.standort).toBe(locationName);
          expect(search.patientType).toBe(patientTypeSegment);
          expect(search.tab).toBe(tabParam);
          expect(Object.values(search).includes(undefined)).toBe(false);
        },
      ),
      "regeln search omits undefined state",
    );
  });
});

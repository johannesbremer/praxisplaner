import { describe, expect, it } from "vitest";

import {
  buildPatientSearchFirstName,
  buildPatientSearchLastName,
  patientMatchesSearchTerm,
} from "../../convex/patientSearch";

describe("patient search helpers", () => {
  it("builds combined first-name search text for structured names", () => {
    expect(
      buildPatientSearchFirstName({
        firstName: "Max",
        lastName: "Mustermann",
      }),
    ).toBe("Max Mustermann");
  });

  it("builds combined last-name search text for structured names", () => {
    expect(
      buildPatientSearchLastName({
        firstName: "Max",
        lastName: "Mustermann",
      }),
    ).toBe("Mustermann Max");
  });

  it("matches combined full-name queries against separate name fields", () => {
    expect(
      patientMatchesSearchTerm(
        {
          firstName: "Max",
          lastName: "Mustermann",
        },
        "max must",
      ),
    ).toBe(true);
  });

  it("matches existing records with inconsistent whitespace and casing", () => {
    expect(
      patientMatchesSearchTerm(
        {
          firstName: "  Anna  ",
          lastName: "  Beispiel ",
        },
        "ann bei",
      ),
    ).toBe(true);
  });

  it("matches temporary patient names without split fields", () => {
    expect(
      patientMatchesSearchTerm(
        {
          name: "Erika Musterfrau",
        },
        "muster",
      ),
    ).toBe(true);
  });

  it("does not match unrelated queries", () => {
    expect(
      patientMatchesSearchTerm(
        {
          firstName: "Max",
          lastName: "Mustermann",
        },
        "schmidt",
      ),
    ).toBe(false);
  });
});

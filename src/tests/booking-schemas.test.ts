import { describe, expect, it } from "vitest";

import {
  dataSharingContactFormSchema,
  personalDataFormSchema,
  pkvDetailsFormSchema,
  toOptionalMedicalHistory,
} from "@/lib/booking-schemas";

describe("booking schema normalization", () => {
  it("omits empty optional personal-data fields", () => {
    const parsed = personalDataFormSchema.parse({
      city: "",
      dateOfBirth: "1990-05-12",
      email: "",
      firstName: "Ada",
      gender: "",
      lastName: "Lovelace",
      phoneNumber: "+491234567890",
      postalCode: "",
      street: "",
      title: "",
    });

    expect(parsed).toEqual({
      dateOfBirth: "1990-05-12",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "+491234567890",
    });
  });

  it("omits an empty data-sharing title", () => {
    const parsed = dataSharingContactFormSchema.parse({
      city: "Berlin",
      dateOfBirth: "1990-05-12",
      firstName: "Ada",
      gender: "female",
      lastName: "Lovelace",
      phoneNumber: "+491234567890",
      postalCode: "10115",
      street: "Unter den Linden 1",
      title: "",
    });

    expect(parsed).toEqual({
      city: "Berlin",
      dateOfBirth: "1990-05-12",
      firstName: "Ada",
      gender: "female",
      lastName: "Lovelace",
      phoneNumber: "+491234567890",
      postalCode: "10115",
      street: "Unter den Linden 1",
    });
  });

  it("omits empty PKV selections", () => {
    const parsed = pkvDetailsFormSchema.parse({
      beihilfeStatus: "",
      pkvInsuranceType: "",
      pkvTariff: "",
    });

    expect(parsed).toEqual({});
  });

  it("returns undefined for an empty medical history", () => {
    const parsed = toOptionalMedicalHistory({
      allergiesDescription: "",
      currentMedications: "",
      hasAllergies: false,
      hasDiabetes: false,
      hasHeartCondition: false,
      hasLungCondition: false,
      otherConditions: "",
    });

    expect(parsed).toBeUndefined();
  });

  it("keeps only filled medical-history fields", () => {
    const parsed = toOptionalMedicalHistory({
      allergiesDescription: "Pollen",
      currentMedications: "",
      hasAllergies: true,
      hasDiabetes: false,
      hasHeartCondition: false,
      hasLungCondition: false,
      otherConditions: "",
    });

    expect(parsed).toEqual({
      allergiesDescription: "Pollen",
      hasAllergies: true,
      hasDiabetes: false,
      hasHeartCondition: false,
      hasLungCondition: false,
    });
  });
});

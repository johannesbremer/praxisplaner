import type { Validator } from "convex/values";

import { v } from "convex/values";

import {
  BEIHILFE_STATUS_VALUES,
  GENDER_VALUES,
  HZV_STATUS_VALUES,
  INSURANCE_TYPE_VALUES,
  PKV_INSURANCE_TYPE_VALUES,
  PKV_TARIFF_VALUES,
} from "../lib/booking-models";

function literalUnionValidator<
  const TValues extends readonly [string, string, ...string[]],
>(values: TValues): Validator<TValues[number]> {
  const [first, second, ...rest] = values;
  return v.union(
    v.literal(first),
    v.literal(second),
    ...rest.map((value) => v.literal(value)),
  ) as Validator<TValues[number]>;
}

export const insuranceTypeValidator = literalUnionValidator(
  INSURANCE_TYPE_VALUES,
);

export const hzvStatusValidator = literalUnionValidator(HZV_STATUS_VALUES);

export const beihilfeStatusValidator = literalUnionValidator(
  BEIHILFE_STATUS_VALUES,
);

export const pkvTariffValidator = literalUnionValidator(PKV_TARIFF_VALUES);

export const pkvInsuranceTypeValidator = literalUnionValidator(
  PKV_INSURANCE_TYPE_VALUES,
);

export const genderValidator = literalUnionValidator(GENDER_VALUES);

export const personalDataValidator = v.object({
  city: v.optional(v.string()),
  dateOfBirth: v.string(),
  email: v.optional(v.string()),
  firstName: v.string(),
  gender: v.optional(genderValidator),
  lastName: v.string(),
  phoneNumber: v.string(),
  postalCode: v.optional(v.string()),
  street: v.optional(v.string()),
  title: v.optional(v.string()),
});

export const dataSharingContactInputValidator = v.object({
  city: v.string(),
  dateOfBirth: v.string(),
  firstName: v.string(),
  gender: genderValidator,
  lastName: v.string(),
  phoneNumber: v.string(),
  postalCode: v.string(),
  street: v.string(),
  title: v.optional(v.string()),
});

export const dataSharingPersonValidator = v.object({
  city: v.string(),
  dateOfBirth: v.string(),
  firstName: v.string(),
  gender: genderValidator,
  lastName: v.string(),
  phoneNumber: v.string(),
  postalCode: v.string(),
  street: v.string(),
  title: v.optional(v.string()),
  userId: v.id("users"),
});

export const medicalHistoryValidator = v.object({
  allergiesDescription: v.optional(v.string()),
  currentMedications: v.optional(v.string()),
  hasAllergies: v.boolean(),
  hasDiabetes: v.boolean(),
  hasHeartCondition: v.boolean(),
  hasLungCondition: v.boolean(),
  otherConditions: v.optional(v.string()),
});

export const emergencyContactValidator = v.object({
  name: v.string(),
  phoneNumber: v.string(),
  relationship: v.string(),
});

export const selectedSlotValidator = v.object({
  practitionerId: v.id("practitioners"),
  practitionerName: v.string(),
  startTime: v.string(),
});

export const gkvDetailsValidator = v.object({
  hzvStatus: hzvStatusValidator,
  insuranceType: v.literal("gkv"),
});

export const pkvDetailsValidator = v.object({
  beihilfeStatus: v.optional(beihilfeStatusValidator),
  insuranceType: v.literal("pkv"),
  pkvInsuranceType: v.optional(pkvInsuranceTypeValidator),
  pkvTariff: v.optional(pkvTariffValidator),
  pvsConsent: v.literal(true),
});

export const insuranceDetailsValidator = v.union(
  gkvDetailsValidator,
  pkvDetailsValidator,
);

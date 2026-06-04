import { v } from "convex/values";

import {
  BEIHILFE_STATUS_VALUES,
  GENDER_VALUES,
  HZV_STATUS_VALUES,
  INSURANCE_TYPE_VALUES,
  PKV_INSURANCE_TYPE_VALUES,
  PKV_TARIFF_VALUES,
} from "../lib/booking-models";

const [GKV_INSURANCE_TYPE, PKV_INSURANCE_TYPE] = INSURANCE_TYPE_VALUES;
const [HZV_HAS_CONTRACT, HZV_INTERESTED, HZV_NO_INTEREST] = HZV_STATUS_VALUES;
const [BEIHILFE_YES, BEIHILFE_NO] = BEIHILFE_STATUS_VALUES;
const [PKV_TARIFF_BASIS, PKV_TARIFF_STANDARD, PKV_TARIFF_PREMIUM] =
  PKV_TARIFF_VALUES;
const [PKV_INSURANCE_POSTB, PKV_INSURANCE_KVB, PKV_INSURANCE_OTHER] =
  PKV_INSURANCE_TYPE_VALUES;
const [GENDER_MALE, GENDER_FEMALE, GENDER_DIVERSE] = GENDER_VALUES;

export const insuranceTypeValidator = v.union(
  v.literal(GKV_INSURANCE_TYPE),
  v.literal(PKV_INSURANCE_TYPE),
);

export const hzvStatusValidator = v.union(
  v.literal(HZV_HAS_CONTRACT),
  v.literal(HZV_INTERESTED),
  v.literal(HZV_NO_INTEREST),
);

export const beihilfeStatusValidator = v.union(
  v.literal(BEIHILFE_YES),
  v.literal(BEIHILFE_NO),
);

export const pkvTariffValidator = v.union(
  v.literal(PKV_TARIFF_BASIS),
  v.literal(PKV_TARIFF_STANDARD),
  v.literal(PKV_TARIFF_PREMIUM),
);

export const pkvInsuranceTypeValidator = v.union(
  v.literal(PKV_INSURANCE_POSTB),
  v.literal(PKV_INSURANCE_KVB),
  v.literal(PKV_INSURANCE_OTHER),
);

export const genderValidator = v.union(
  v.literal(GENDER_MALE),
  v.literal(GENDER_FEMALE),
  v.literal(GENDER_DIVERSE),
);

export const personalDataValidator = v.object({
  city: v.string(),
  dateOfBirth: v.string(),
  email: v.string(),
  firstName: v.string(),
  gender: genderValidator,
  lastName: v.string(),
  phoneNumber: v.string(),
  postalCode: v.string(),
  street: v.string(),
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

export const medicalHistoryValidator = v.object({
  allergiesDescription: v.optional(v.string()),
  currentMedications: v.optional(v.string()),
  hasAllergies: v.boolean(),
  hasDiabetes: v.boolean(),
  hasHeartCondition: v.boolean(),
  hasLungCondition: v.boolean(),
  otherConditions: v.optional(v.string()),
});

export const legacyMedicalHistorySnapshotValidator = v.object({
  allergyNotes: v.optional(v.string()),
  currentMedications: v.optional(v.string()),
  hasAllergies: v.boolean(),
  hasCancer: v.boolean(),
  hasCirculationDisorder: v.boolean(),
  hasDepression: v.boolean(),
  hasDiabetes: v.boolean(),
  hasGout: v.boolean(),
  hasHeartCondition: v.boolean(),
  hasHypertension: v.boolean(),
  hasIntolerance: v.boolean(),
  hasKidneyCondition: v.boolean(),
  hasLipidDisorder: v.boolean(),
  hasLiverCondition: v.boolean(),
  hasLungCondition: v.boolean(),
  hasOperations: v.boolean(),
  hasSymptoms: v.boolean(),
  hasThyroidCondition: v.boolean(),
  hasVaricoseVeins: v.boolean(),
  intoleranceNotes: v.optional(v.string()),
  medicationNotes: v.optional(v.string()),
  noAdditionalDetails: v.boolean(),
  noKnownConditions: v.boolean(),
  operationNotes: v.optional(v.string()),
  otherConditionNotes: v.optional(v.string()),
  smokes: v.boolean(),
  symptomNotes: v.optional(v.string()),
  takesMedication: v.boolean(),
});

export const selectedSlotValidator = v.object({
  practitionerLineageKey: v.id("practitioners"),
  practitionerName: v.string(),
  startTime: v.string(),
});

export const selectedSlotStorageValidator = selectedSlotValidator;

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

import { z } from "zod";

import type {
  DataSharingContactInput,
  MedicalHistoryInput,
  PersonalDataInput,
  PkvDetailsInput,
} from "../convex/typedDtos";

import {
  BEIHILFE_STATUS_VALUES,
  GENDER_VALUES,
  PKV_INSURANCE_TYPE_VALUES,
  PKV_TARIFF_VALUES,
} from "./booking-models";
import {
  isIsoDateString,
  ISO_DATE_REGEX,
  type IsoDateString,
} from "./typed-regex";

const optionalTextSchema = z.string().optional();
const optionalTrimmedTextInputSchema = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value));

const isoDateSchema = z
  .string()
  .refine(
    (value) => ISO_DATE_REGEX.test(value),
    "Geburtsdatum muss im Format YYYY-MM-DD sein",
  );
const isoDateInputSchema = z
  .string()
  .trim()
  .min(1, "Geburtsdatum ist erforderlich")
  .refine(
    (value) => ISO_DATE_REGEX.test(value),
    "Geburtsdatum muss im Format YYYY-MM-DD sein",
  );

const requiredTextInputSchema = (message: string) =>
  z.string().trim().min(1, message);

function isOneOfStringLiterals<const TValues extends readonly string[]>(
  values: TValues,
  value: string,
): value is TValues[number] {
  return values.includes(value);
}

const requiredEnumInputSchema = <
  const TValues extends readonly [string, ...string[]],
>(
  values: TValues,
  error: string,
) =>
  z.string().transform((value, ctx): TValues[number] | typeof z.NEVER => {
    if (isOneOfStringLiterals(values, value)) {
      return value;
    }

    ctx.addIssue({
      code: "custom",
      message: error,
    });
    return z.NEVER;
  });

const optionalEnumInputSchema = <
  const TValues extends readonly [string, ...string[]],
>(
  values: TValues,
) =>
  z
    .string()
    .transform((value, ctx): TValues[number] | typeof z.NEVER | undefined => {
      if (value === "") {
        return undefined;
      }

      if (isOneOfStringLiterals(values, value)) {
        return value;
      }

      ctx.addIssue({
        code: "custom",
        message: "Ungültiger Wert",
      });
      return z.NEVER;
    });

export const personalDataInputSchema = z.object({
  city: optionalTextSchema,
  dateOfBirth: isoDateSchema,
  email: optionalTextSchema,
  firstName: z.string(),
  gender: z.enum(GENDER_VALUES).optional(),
  lastName: z.string(),
  phoneNumber: z.e164(),
  postalCode: optionalTextSchema,
  street: optionalTextSchema,
  title: optionalTextSchema,
});

export const medicalHistoryInputSchema = z.object({
  allergiesDescription: optionalTextSchema,
  currentMedications: optionalTextSchema,
  hasAllergies: z.boolean(),
  hasDiabetes: z.boolean(),
  hasHeartCondition: z.boolean(),
  hasLungCondition: z.boolean(),
  otherConditions: optionalTextSchema,
});

export const dataSharingContactInputSchema = z.object({
  city: z.string(),
  dateOfBirth: isoDateSchema,
  firstName: z.string(),
  gender: z.enum(GENDER_VALUES),
  lastName: z.string(),
  phoneNumber: z.e164(),
  postalCode: z.string(),
  street: z.string(),
  title: optionalTextSchema,
});

export const pkvDetailsInputSchema = z.object({
  beihilfeStatus: z.enum(BEIHILFE_STATUS_VALUES).optional(),
  pkvInsuranceType: z.enum(PKV_INSURANCE_TYPE_VALUES).optional(),
  pkvTariff: z.enum(PKV_TARIFF_VALUES).optional(),
});

export const personalDataFormSchema = z
  .object({
    city: optionalTrimmedTextInputSchema,
    dateOfBirth: isoDateInputSchema,
    email: optionalTrimmedTextInputSchema,
    firstName: requiredTextInputSchema("Vorname ist erforderlich"),
    gender: optionalEnumInputSchema(GENDER_VALUES),
    lastName: requiredTextInputSchema("Nachname ist erforderlich"),
    phoneNumber: z.e164(
      "Bitte gültige Telefonnummer im Format +49... eingeben",
    ),
    postalCode: optionalTrimmedTextInputSchema,
    street: optionalTrimmedTextInputSchema,
    title: optionalTrimmedTextInputSchema,
  })
  .transform((value) => toPersonalDataInput(value));

export const medicalHistoryFormSchema = z.object({
  allergiesDescription: z.string(),
  currentMedications: z.string(),
  hasAllergies: z.boolean(),
  hasDiabetes: z.boolean(),
  hasHeartCondition: z.boolean(),
  hasLungCondition: z.boolean(),
  otherConditions: z.string(),
});

export const bookingDataInputFormSchema = z.object({
  medicalHistory: medicalHistoryFormSchema,
  personalData: personalDataFormSchema,
});

export const dataSharingContactFormSchema = z
  .object({
    city: requiredTextInputSchema("Ort ist erforderlich"),
    dateOfBirth: isoDateInputSchema,
    firstName: requiredTextInputSchema("Vorname ist erforderlich"),
    gender: requiredEnumInputSchema(
      GENDER_VALUES,
      "Geschlecht ist erforderlich",
    ),
    lastName: requiredTextInputSchema("Nachname ist erforderlich"),
    phoneNumber: z.e164(
      "Bitte gültige Telefonnummer im Format +49... eingeben",
    ),
    postalCode: requiredTextInputSchema("PLZ ist erforderlich"),
    street: requiredTextInputSchema("Straße ist erforderlich"),
    title: optionalTrimmedTextInputSchema,
  })
  .transform((value) => toDataSharingContactInput(value));

export const dataSharingContactsFormSchema = z.array(
  dataSharingContactFormSchema,
);

export const pkvDetailsFormSchema = z
  .object({
    beihilfeStatus: optionalEnumInputSchema(BEIHILFE_STATUS_VALUES),
    pkvInsuranceType: optionalEnumInputSchema(PKV_INSURANCE_TYPE_VALUES),
    pkvTariff: optionalEnumInputSchema(PKV_TARIFF_VALUES),
  })
  .transform((value) => toPkvDetailsInput(value));

export type DataInputFormValue = z.input<typeof bookingDataInputFormSchema>;
export type DataSharingContactFormValue = z.input<
  typeof dataSharingContactFormSchema
>;
export type MedicalHistoryFormValue = z.input<typeof medicalHistoryFormSchema>;
export type PkvDetailsFormValue = z.input<typeof pkvDetailsFormSchema>;

export function toDataSharingContactInput(value: {
  city: string;
  dateOfBirth: string;
  firstName: string;
  gender: (typeof GENDER_VALUES)[number];
  lastName: string;
  phoneNumber: string;
  postalCode: string;
  street: string;
  title?: string | undefined;
}): DataSharingContactInput {
  const contact: DataSharingContactInput = {
    city: value.city,
    dateOfBirth: toIsoDateString(value.dateOfBirth),
    firstName: value.firstName,
    gender: value.gender,
    lastName: value.lastName,
    phoneNumber: value.phoneNumber,
    postalCode: value.postalCode,
    street: value.street,
  };

  if (value.title !== undefined) {
    contact.title = value.title;
  }

  return contact;
}

export function toDataSharingContactInputs(
  value: {
    city: string;
    dateOfBirth: string;
    firstName: string;
    gender: (typeof GENDER_VALUES)[number];
    lastName: string;
    phoneNumber: string;
    postalCode: string;
    street: string;
    title?: string | undefined;
  }[],
): DataSharingContactInput[] {
  return value.map((contact) => toDataSharingContactInput(contact));
}

export function toOptionalMedicalHistory(
  value: MedicalHistoryFormValue,
): MedicalHistoryInput | undefined {
  const normalized: MedicalHistoryInput = {
    hasAllergies: value.hasAllergies,
    hasDiabetes: value.hasDiabetes,
    hasHeartCondition: value.hasHeartCondition,
    hasLungCondition: value.hasLungCondition,
  };

  if (value.allergiesDescription.trim() !== "") {
    normalized.allergiesDescription = value.allergiesDescription;
  }
  if (value.currentMedications.trim() !== "") {
    normalized.currentMedications = value.currentMedications;
  }
  if (value.otherConditions.trim() !== "") {
    normalized.otherConditions = value.otherConditions;
  }

  const hasMedicalHistory =
    normalized.hasAllergies ||
    normalized.hasDiabetes ||
    normalized.hasHeartCondition ||
    normalized.hasLungCondition ||
    "allergiesDescription" in normalized ||
    "currentMedications" in normalized ||
    "otherConditions" in normalized;

  return hasMedicalHistory ? normalized : undefined;
}

export function toPersonalDataInput(value: {
  city?: string | undefined;
  dateOfBirth: string;
  email?: string | undefined;
  firstName: string;
  gender?: (typeof GENDER_VALUES)[number] | undefined;
  lastName: string;
  phoneNumber: string;
  postalCode?: string | undefined;
  street?: string | undefined;
  title?: string | undefined;
}): PersonalDataInput {
  const personalData: PersonalDataInput = {
    dateOfBirth: toIsoDateString(value.dateOfBirth),
    firstName: value.firstName,
    lastName: value.lastName,
    phoneNumber: value.phoneNumber,
  };

  if (value.city !== undefined) {
    personalData.city = value.city;
  }
  if (value.email !== undefined) {
    personalData.email = value.email;
  }
  if (value.gender !== undefined) {
    personalData.gender = value.gender;
  }
  if (value.postalCode !== undefined) {
    personalData.postalCode = value.postalCode;
  }
  if (value.street !== undefined) {
    personalData.street = value.street;
  }
  if (value.title !== undefined) {
    personalData.title = value.title;
  }

  return personalData;
}

export function toPkvDetailsInput(value: {
  beihilfeStatus?: (typeof BEIHILFE_STATUS_VALUES)[number] | undefined;
  pkvInsuranceType?: (typeof PKV_INSURANCE_TYPE_VALUES)[number] | undefined;
  pkvTariff?: (typeof PKV_TARIFF_VALUES)[number] | undefined;
}): PkvDetailsInput {
  const details: PkvDetailsInput = {};

  if (value.beihilfeStatus !== undefined) {
    details.beihilfeStatus = value.beihilfeStatus;
  }
  if (value.pkvInsuranceType !== undefined) {
    details.pkvInsuranceType = value.pkvInsuranceType;
  }
  if (value.pkvTariff !== undefined) {
    details.pkvTariff = value.pkvTariff;
  }

  return details;
}

function toIsoDateString(value: string): IsoDateString {
  if (!isIsoDateString(value)) {
    throw new Error(`Expected YYYY-MM-DD date string, got "${value}".`);
  }

  return value;
}

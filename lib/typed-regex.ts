import { regex } from "./arkregex";

export const ISO_DATE_REGEX = regex.as<
  `${number}-${number}-${number}`,
  { captures: [`${number}`, `${number}`, `${number}`] }
>(String.raw`^(\d{4})-(\d{2})-(\d{2})$`);
export type InstantString = `${IsoDateString}T${string}Z`;
export type IsoDateString = typeof ISO_DATE_REGEX.infer;

export const DE_DATE_REGEX = regex.as<
  `${number}.${number}.${number}`,
  { captures: [`${number}`, `${number}`, `${number}`] }
>(String.raw`^(\d{2})\.(\d{2})\.(\d{4})$`);
export type DeDateString = typeof DE_DATE_REGEX.infer;

export const GDT_DATE_REGEX = regex.as<
  `${number}${number}${number}${number}${number}${number}${number}${number}`,
  { captures: [`${number}`, `${number}`, `${number}`] }
>(String.raw`^(\d{2})(\d{2})(\d{4})$`);
export type GdtDateString = typeof GDT_DATE_REGEX.infer;

export const TIME_OF_DAY_REGEX = regex.as<
  `${number}:${number}`,
  { captures: [`${number}`, `${number}`] }
>(String.raw`^([01]\d|2[0-3]):([0-5]\d)$`);
export type TimeString = typeof TIME_OF_DAY_REGEX.infer;

export const GDT_LINE_REGEX = regex.as<
  string,
  { captures: [`${number}`, string, string] }
>(String.raw`^(\d{3})(\d{4})(.*)$`);

export const SOURCE_RULE_SET_NOT_FOUND_REGEX = regex.as(
  "source rule set not found",
  "i",
);
export const APPOINTMENT_TYPE_MISSING_ENTITY_REGEX = regex.as(
  "already deleted|bereits gelöscht|appointment type not found|terminart.*nicht gefunden",
  "i",
);
export const BASE_SCHEDULE_MISSING_ENTITY_REGEX = regex.as(
  "already deleted|bereits gelöscht|base schedule not found|arbeitszeit.*nicht gefunden",
  "i",
);
export const LOCATION_MISSING_ENTITY_REGEX = regex.as(
  "already deleted|bereits gelöscht|location not found|standort.*nicht gefunden",
  "i",
);
export const PRACTITIONER_MISSING_ENTITY_REGEX = regex.as(
  "already deleted|bereits gelöscht|practitioner not found|arzt.*nicht gefunden|behandler.*nicht gefunden|PRACTITIONER_RESOLVE_FAILED",
  "i",
);
export const RULE_MISSING_ENTITY_REGEX = regex.as(
  "already deleted|bereits gelöscht|rule not found|regel.*nicht gefunden",
  "i",
);

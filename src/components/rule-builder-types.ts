import type { Id } from "../../convex/_generated/dataModel";

export interface Condition {
  appointmentTypes?: null | string[];
  count?: null | number;
  id: string;
  operator?: "GREATER_THAN_OR_EQUAL" | "IS" | "IS_NOT" | "LESS_THAN";
  scope?: "location" | "practice" | "practitioner" | null;
  type: ConditionType;
  valueIds?: string[];
  valueNumber?: null | number;
}

export type ConditionType =
  | "APPOINTMENT_TYPE"
  | "CONCURRENT_COUNT"
  | "DAILY_CAPACITY"
  | "DAY_OF_WEEK"
  | "DAYS_AHEAD"
  | "HOURS_AHEAD"
  | "LOCATION"
  | "PATIENT_AGE"
  | "PRACTITIONER";

export interface NamedEntity {
  _id: string;
  lineageKey?: string;
  name: string;
}

export interface RuleFromDB {
  _id: Id<"ruleConditions">;
  conditionTree: unknown;
  copyFromId: Id<"ruleConditions"> | undefined;
  createdAt: bigint;
  enabled: boolean;
  lastModified: bigint;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

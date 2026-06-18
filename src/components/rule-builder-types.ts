import type { Id } from "../../convex/_generated/dataModel";
import type {
  ConditionType as CanonicalConditionType,
  ConditionTreeNode,
} from "../../lib/condition-tree";
import type { AdvanceTimeUnit } from "../../lib/rule-name-generator";

export interface Condition {
  advanceUnit?: AdvanceTimeUnit | null;
  appointmentTypes?: null | string[];
  count?: null | number;
  id: string;
  operator?:
    | "GREATER_THAN"
    | "GREATER_THAN_OR_EQUAL"
    | "IS"
    | "IS_NOT"
    | "LESS_THAN";
  scope?: "location" | "practice" | "practitioner" | null;
  type: ConditionType;
  valueIds?: string[];
  valueNumber?: null | number;
}

export type ConditionType = CanonicalConditionType;

export interface RuleFromDB {
  _id: Id<"ruleConditions">;
  conditionTree: ConditionTreeNode;
  copyFromId: Id<"ruleConditions"> | undefined;
  createdAt: bigint;
  lastModified: bigint;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

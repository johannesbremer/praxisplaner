/**
 * Rule Engine - Evaluation of tree-based rule conditions
 *
 * This module provides functions to evaluate rule condition trees against appointment contexts.
 * The rule system uses a recursive tree structure with AND/NOT logical operators and leaf conditions.
 *
 * Key Functions:
 * - evaluateCondition: Evaluate a single leaf condition against appointment context
 * - evaluateConditionTree: Recursively evaluate a condition tree (with AND/NOT operators)
 * - checkRulesForAppointment: Main entry point - check all rules for an appointment
 * - buildPreloadedDayData: Pre-load all data needed for condition evaluation (called once per query)
 */

import type { Infer, Validator } from "convex/values";

import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type {
  ConditionNode,
  ConditionTreeNode,
  LogicalNode,
} from "../lib/condition-tree.js";
import type { IsoDateString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

import {
  CONDITION_OPERATORS,
  CONDITION_TYPES,
  isConditionNode,
  isLogicalNode,
  LOGICAL_NODE_TYPES,
  SCOPES,
} from "../lib/condition-tree.js";
import {
  conditionTreeToConditions,
  generateRuleName,
} from "../lib/rule-name-generator.js";
import {
  isIsoDateString,
  ISO_DATE_REGEX,
  isZonedDateTimeString,
} from "../lib/typed-regex.js";
import { internalQuery } from "./_generated/server";
import { requireLineageKey } from "./lineage";
import { createDepthBoundedRecursiveUnionValidator } from "./recursiveValidator";

// ============================================================================
// Pre-loaded Data Types and Builder
// ============================================================================

/**
 * Pre-parsed appointment with epoch milliseconds for fast overlap detection.
 * Epoch times are computed once during buildPreloadedDayData to avoid repeated Temporal parsing.
 */
export interface ParsedAppointment {
  /** Original appointment document */
  appointment: Doc<"appointments">;
  /** Appointment type id resolved into the evaluated rule set when possible */
  appointmentTypeId?: Id<"appointmentTypes">;
  /** Start time as epoch milliseconds (for fast comparison) */
  startEpochMs: number;
  /** End time as epoch milliseconds (for fast comparison) */
  endEpochMs: number;
  /** Location id resolved into the evaluated rule set when possible */
  locationId?: Id<"locations">;
  /** Practitioner id resolved into the evaluated rule set when possible */
  practitionerId?: Id<"practitioners">;
}

/**
 * Pre-loaded data for efficient condition evaluation.
 * Built once per query execution before the slot loop, enabling O(1) lookups instead of per-slot DB queries.
 */
export interface PreloadedDayData {
  /**
   * All appointments for the day, for flexible filtering.
   * Used by CONCURRENT_COUNT which needs to filter by scope and appointment types.
   */
  appointments: Doc<"appointments">[];

  /**
   * Pre-parsed appointments with epoch times for CONCURRENT_COUNT overlap detection.
   * Grouped by scope key for efficient filtering:
   * - "practice": all appointments
   * - "location:locationId": appointments at this location
   * - "practitioner:practitionerId": appointments for this practitioner
   */
  parsedAppointmentsByScope: Map<string, ParsedAppointment[]>;

  /**
   * Pre-computed daily capacity counts by scope.
   * Key formats:
   * - "practice:appointmentTypeId" - practice-wide count for an appointment type
   * - "location:locationId:appointmentTypeId" - location-specific count
   * - "practitioner:practitionerId:appointmentTypeId" - practitioner-specific count
   * Value: count of existing appointments matching that combination
   */
  dailyCapacityCounts: Map<string, number>;

  /**
   * Appointments grouped by start time for CONCURRENT_COUNT lookups.
   * Key: start time string (ISO ZonedDateTime)
   * Value: array of appointments starting at that time
   */
  appointmentsByStartTime: Map<string, Doc<"appointments">[]>;

  /**
   * Practitioners by ID for PRACTITIONER_TAG lookups.
   * Reuses practitioners already loaded by the caller.
   */
  practitioners: Map<Id<"practitioners">, Doc<"practitioners">>;
}

/**
 * Build pre-loaded data for a single day's condition evaluation.
 * This function should be called ONCE per query execution (e.g., getSlotsForDay), before the slot loop.
 * The "day" in the name refers to the date parameter, not a caching duration.
 * @param db Database reader
 * @param practiceId Practice to query appointments for
 * @param day Day as ISO date string (YYYY-MM-DD format)
 * @param ruleSetId Rule set whose entity IDs should be used for lookups
 * @param practitioners Pre-loaded practitioners array (reuse from caller to avoid duplicate query)
 */
export async function buildPreloadedDayData(
  db: DatabaseReader,
  practiceId: Id<"practices">,
  day: string,
  ruleSetId: Id<"ruleSets">,
  practitioners: Doc<"practitioners">[],
): Promise<PreloadedDayData> {
  // Parse the day and compute day boundaries
  const plainDate = Temporal.PlainDate.from(day);
  const dayStartZdt = plainDate.toZonedDateTime({
    plainTime: new Temporal.PlainTime(0, 0),
    timeZone: "Europe/Berlin",
  });
  const dayEndZdt = plainDate.add({ days: 1 }).toZonedDateTime({
    plainTime: new Temporal.PlainTime(0, 0),
    timeZone: "Europe/Berlin",
  });

  const dayStartStr = dayStartZdt.toString();
  const dayEndStr = dayEndZdt.toString();

  // Query appointments for this practice and day only
  // Use compound index by_practiceId_start with both bounds for efficient filtering
  const rawAppointments = await db
    .query("appointments")
    .withIndex("by_practiceId_start", (q) =>
      q
        .eq("practiceId", practiceId)
        .gte("start", dayStartStr)
        .lt("start", dayEndStr),
    )
    .collect();
  const appointments = rawAppointments.filter(
    (appointment) => appointment.cancelledAt === undefined,
  );

  const [ruleSetAppointmentTypes, ruleSetLocations] = await Promise.all([
    db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
    db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
  ]);

  const appointmentTypeIdByLineage = new Map(
    ruleSetAppointmentTypes
      .filter((appointmentType) => appointmentType.practiceId === practiceId)
      .map((appointmentType) => [
        requireLineageKey({
          entityId: appointmentType._id,
          entityType: "appointment type",
          lineageKey: appointmentType.lineageKey,
          ruleSetId: appointmentType.ruleSetId,
        }),
        appointmentType._id,
      ]),
  );
  const locationIdByLineage = new Map(
    ruleSetLocations
      .filter((location) => location.practiceId === practiceId)
      .map((location) => [
        requireLineageKey({
          entityId: location._id,
          entityType: "location",
          lineageKey: location.lineageKey,
          ruleSetId: location.ruleSetId,
        }),
        location._id,
      ]),
  );
  const practitionerIdByLineage = new Map(
    practitioners
      .filter(
        (practitioner) =>
          practitioner.practiceId === practiceId &&
          practitioner.ruleSetId === ruleSetId,
      )
      .map((practitioner) => [
        requireLineageKey({
          entityId: practitioner._id,
          entityType: "practitioner",
          lineageKey: practitioner.lineageKey,
          ruleSetId: practitioner.ruleSetId,
        }),
        practitioner._id,
      ]),
  );

  // Build parsed appointments with pre-computed epoch times for fast overlap detection
  // Group by scope for efficient CONCURRENT_COUNT filtering
  const parsedAppointmentsByScope = new Map<string, ParsedAppointment[]>();

  // Initialize practice-wide list
  const practiceKey = "practice";
  const practiceAppointments: ParsedAppointment[] = [];
  parsedAppointmentsByScope.set(practiceKey, practiceAppointments);

  for (const apt of appointments) {
    const appointmentTypeId = appointmentTypeIdByLineage.get(
      apt.appointmentTypeLineageKey,
    );
    const locationIdForRuleSet = locationIdByLineage.get(
      apt.locationLineageKey,
    );
    const practitionerIdForRuleSet = apt.practitionerLineageKey
      ? practitionerIdByLineage.get(apt.practitionerLineageKey)
      : undefined;

    // Parse times once per appointment (expensive operation)
    const startZdt = Temporal.ZonedDateTime.from(apt.start);
    const endZdt = Temporal.ZonedDateTime.from(apt.end);
    const parsed: ParsedAppointment = {
      appointment: apt,
      ...(appointmentTypeId ? { appointmentTypeId } : {}),
      endEpochMs: endZdt.epochMilliseconds,
      ...(locationIdForRuleSet ? { locationId: locationIdForRuleSet } : {}),
      ...(practitionerIdForRuleSet
        ? { practitionerId: practitionerIdForRuleSet }
        : {}),
      startEpochMs: startZdt.epochMilliseconds,
    };

    // Add to practice-wide list
    practiceAppointments.push(parsed);

    // Add to location-specific list
    if (locationIdForRuleSet) {
      const locationKey = `location:${locationIdForRuleSet}`;
      let locationAppointments = parsedAppointmentsByScope.get(locationKey);
      if (!locationAppointments) {
        locationAppointments = [];
        parsedAppointmentsByScope.set(locationKey, locationAppointments);
      }
      locationAppointments.push(parsed);
    }

    // Add to practitioner-specific list (if practitioner assigned)
    if (practitionerIdForRuleSet) {
      const practitionerKey = `practitioner:${practitionerIdForRuleSet}`;
      let practitionerAppointments =
        parsedAppointmentsByScope.get(practitionerKey);
      if (!practitionerAppointments) {
        practitionerAppointments = [];
        parsedAppointmentsByScope.set(
          practitionerKey,
          practitionerAppointments,
        );
      }
      practitionerAppointments.push(parsed);
    }
  }

  // Build daily capacity counts by scope
  // Multiple keys per appointment: practice, location, and practitioner scope
  const dailyCapacityCounts = new Map<string, number>();
  for (const apt of appointments) {
    const typeId = appointmentTypeIdByLineage.get(
      apt.appointmentTypeLineageKey,
    );

    dailyCapacityCounts.set(
      "practice:__all__",
      (dailyCapacityCounts.get("practice:__all__") ?? 0) + 1,
    );

    const locationIdForRuleSet = locationIdByLineage.get(
      apt.locationLineageKey,
    );
    if (locationIdForRuleSet) {
      const locationAllKey = `location:${locationIdForRuleSet}:__all__`;
      dailyCapacityCounts.set(
        locationAllKey,
        (dailyCapacityCounts.get(locationAllKey) ?? 0) + 1,
      );
    }

    const practitionerIdForRuleSet = apt.practitionerLineageKey
      ? practitionerIdByLineage.get(apt.practitionerLineageKey)
      : undefined;
    if (practitionerIdForRuleSet) {
      const practitionerAllKey = `practitioner:${practitionerIdForRuleSet}:__all__`;
      dailyCapacityCounts.set(
        practitionerAllKey,
        (dailyCapacityCounts.get(practitionerAllKey) ?? 0) + 1,
      );
    }

    if (!typeId) {
      continue;
    }

    const practiceTypeKey = `practice:${typeId}`;
    dailyCapacityCounts.set(
      practiceTypeKey,
      (dailyCapacityCounts.get(practiceTypeKey) ?? 0) + 1,
    );

    if (locationIdForRuleSet) {
      const locationTypeKey = `location:${locationIdForRuleSet}:${typeId}`;
      dailyCapacityCounts.set(
        locationTypeKey,
        (dailyCapacityCounts.get(locationTypeKey) ?? 0) + 1,
      );
    }

    if (practitionerIdForRuleSet) {
      const practitionerTypeKey = `practitioner:${practitionerIdForRuleSet}:${typeId}`;
      dailyCapacityCounts.set(
        practitionerTypeKey,
        (dailyCapacityCounts.get(practitionerTypeKey) ?? 0) + 1,
      );
    }
  }

  // Build appointments by start time map (still useful for exact start time lookups)
  const appointmentsByStartTime = new Map<string, Doc<"appointments">[]>();
  for (const apt of appointments) {
    const existing = appointmentsByStartTime.get(apt.start) ?? [];
    existing.push(apt);
    appointmentsByStartTime.set(apt.start, existing);
  }

  // Build practitioners map from passed-in array
  const practitionersMap = new Map<Id<"practitioners">, Doc<"practitioners">>();
  for (const practitioner of practitioners.filter(
    (candidate) => candidate.ruleSetId === ruleSetId,
  )) {
    practitionersMap.set(practitioner._id, practitioner);
  }

  return {
    appointments,
    appointmentsByStartTime,
    dailyCapacityCounts,
    parsedAppointmentsByScope,
    practitioners: practitionersMap,
  };
}

/**
 * Validator for appointment context used in rule evaluation.
 * This is the data available when evaluating whether a rule should block an appointment.
 */
export const appointmentContextValidator = v.object({
  appointmentTypeId: v.optional(v.id("appointmentTypes")),
  // Client type (e.g., "Online", "MFA", "Phone-AI")
  clientType: v.optional(v.string()),
  // ISO datetime string
  dateTime: v.string(),
  locationId: v.optional(v.id("locations")),
  // Patient birth date as YYYY-MM-DD
  patientDateOfBirth: v.optional(v.string()),
  practiceId: v.id("practices"),
  practitionerId: v.id("practitioners"),
  // For DAYS_AHEAD / HOURS_AHEAD conditions: when was this appointment requested
  // in the scheduling timezone?
  requestedAt: v.optional(v.string()), // ISO zoned datetime string
});

type RuleEngineZonedDateTimeString = `${IsoDateString}T${string}`;

/**
 * Type-safe appointment context derived from validator.
 */
export type AppointmentContext = Omit<
  Infer<typeof appointmentContextValidator>,
  "dateTime" | "patientDateOfBirth" | "requestedAt"
> & {
  dateTime: RuleEngineZonedDateTimeString;
  patientDateOfBirth?: IsoDateString;
  requestedAt?: RuleEngineZonedDateTimeString;
};

export function asAppointmentContextInput(
  value: Infer<typeof appointmentContextValidator>,
): AppointmentContext {
  const {
    dateTime,
    patientDateOfBirth: rawPatientDateOfBirth,
    requestedAt: rawRequestedAt,
    ...rest
  } = value;
  if (
    rawPatientDateOfBirth !== undefined &&
    !isIsoDateString(rawPatientDateOfBirth)
  ) {
    throw new Error(
      `Expected YYYY-MM-DD date string, got "${rawPatientDateOfBirth}".`,
    );
  }
  const requestedAt =
    rawRequestedAt === undefined
      ? undefined
      : asRuleEngineZonedDateTimeString(rawRequestedAt);

  return {
    ...rest,
    dateTime: asRuleEngineZonedDateTimeString(dateTime),
    ...(rawPatientDateOfBirth !== undefined && {
      patientDateOfBirth: rawPatientDateOfBirth,
    }),
    ...(requestedAt !== undefined && { requestedAt }),
  };
}

function asRuleEngineZonedDateTimeString(
  value: string,
): RuleEngineZonedDateTimeString {
  try {
    const normalized = Temporal.ZonedDateTime.from(value).toString();
    if (!isZonedDateTimeString(normalized)) {
      throw new Error(`Expected ISO zoned datetime string, got "${value}".`);
    }

    return normalized;
  } catch {
    throw new Error(`Expected ISO zoned datetime string, got "${value}".`);
  }
}

/**
 * Day-invariant condition types - these only depend on the date and fixed query context,
 * not time-of-day or per-slot variations, AND don't require database reads beyond initial
 * rule/condition loading. These can be pre-evaluated once per getSlotsForDay call.
 *
 * INCLUDED (query-invariant, no DB reads, fixed per query execution):
 * - APPOINTMENT_TYPE: Fixed in simulatedContext for entire query
 * - LOCATION: Fixed in simulatedContext for entire query
 * - CLIENT_TYPE: Fixed (patient.isNew) for entire query
 * - DATE_RANGE, DAY_OF_WEEK, DAYS_AHEAD, PATIENT_AGE: Only depend on target date + fixed patient context
 *
 * EXCLUDED conditions (vary per slot OR require DB reads during evaluation):
 * - PRACTITIONER: Varies per slot (different practitioner columns in staff view)
 * - HOURS_AHEAD: Depends on exact slot timestamp, so it can vary within a day
 * - DAILY_CAPACITY: Queries appointments table to count existing appointments
 * - PRACTITIONER_TAG: Queries practitioner document to check tags
 * - CONCURRENT_COUNT: Queries appointments table (also time-variant)
 */
const DAY_INVARIANT_CONDITION_TYPES = new Set([
  "APPOINTMENT_TYPE",
  "CLIENT_TYPE",
  "DATE_RANGE",
  "DAY_OF_WEEK",
  "DAYS_AHEAD",
  "LOCATION",
  "PATIENT_AGE",
]);

/**
 * Parses a patient birth date.
 */
function parsePatientBirthDate(dateString: string): Temporal.PlainDate {
  // Supported format: YYYY-MM-DD
  const isoMatch = ISO_DATE_REGEX.exec(dateString);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return Temporal.PlainDate.from(`${year}-${month}-${day}`);
  }

  throw new Error(
    `Invalid patientDateOfBirth format: "${dateString}". Expected "YYYY-MM-DD".`,
  );
}

/**
 * Calculate age in full years at a given reference date.
 */
function getAgeYearsAtDate(
  birthDate: Temporal.PlainDate,
  referenceDate: Temporal.PlainDate,
): number {
  let years = referenceDate.year - birthDate.year;

  if (
    referenceDate.month < birthDate.month ||
    (referenceDate.month === birthDate.month &&
      referenceDate.day < birthDate.day)
  ) {
    years -= 1;
  }

  return years;
}

/**
 * Evaluate a single leaf condition against the appointment context.
 * Returns true if the condition matches (which may mean the appointment should be blocked).
 * @param condition The condition to evaluate
 * @param context Appointment context
 * @param preloadedData Pre-loaded data for O(1) lookups (required for DAILY_CAPACITY, CONCURRENT_COUNT, PRACTITIONER_TAG)
 */
function evaluateCondition(
  condition: Doc<"ruleConditions">,
  context: AppointmentContext,
  preloadedData: PreloadedDayData,
): boolean {
  // Only evaluate leaf conditions
  if (condition.nodeType !== "CONDITION") {
    throw new Error(
      `evaluateCondition called on non-CONDITION node: ${condition.nodeType}`,
    );
  }

  if (!condition.conditionType || !condition.operator) {
    throw new Error("Condition missing conditionType or operator");
  }

  const { conditionType, operator, valueIds, valueNumber } = condition;

  // Helper for comparing values
  const compareValue = (actual: number, expected: number): boolean => {
    switch (operator) {
      case "EQUALS": {
        return actual === expected;
      }
      case "GREATER_THAN_OR_EQUAL": {
        return actual >= expected;
      }
      case "LESS_THAN": {
        return actual < expected;
      }
      case "LESS_THAN_OR_EQUAL": {
        return actual <= expected;
      }
      default: {
        return false;
      }
    }
  };

  // Helper for checking ID membership
  const checkIdMembership = (
    actualId: string | undefined,
    allowedIds: string[] | undefined,
  ): boolean => {
    if (!actualId || !allowedIds || allowedIds.length === 0) {
      return false;
    }
    const isInList = allowedIds.includes(actualId);
    return operator === "IS" ? isInList : !isInList; // IS_NOT inverts the result
  };

  switch (conditionType) {
    case "APPOINTMENT_TYPE": {
      // Compare appointment type IDs
      return checkIdMembership(context.appointmentTypeId, valueIds);
    }

    case "CLIENT_TYPE": {
      // Compare client type (e.g., "Online", "MFA", "Phone-AI")
      const isMatch =
        valueIds && valueIds.length > 0 && context.clientType
          ? valueIds.includes(context.clientType)
          : false;
      return operator === "IS" ? isMatch : !isMatch;
    }

    case "CONCURRENT_COUNT": {
      // Check concurrent (overlapping) appointments at a specific time slot
      // scope: "practice", "location", or "practitioner"
      // valueIds: optional list of appointment types to count
      // valueNumber: the count threshold
      //
      // An appointment overlaps with time T if: appointment.start <= T < appointment.end
      if (valueNumber === undefined) {
        return false;
      }

      const scope = condition.scope;
      const appointmentTypeIds = valueIds ?? [];

      // Determine scope key for lookup in pre-computed map
      let scopeKey: string;
      if (scope === "location" && context.locationId) {
        scopeKey = `location:${context.locationId}`;
      } else if (scope === "practitioner" && context.practitionerId) {
        scopeKey = `practitioner:${context.practitionerId}`;
      } else {
        scopeKey = "practice";
      }

      // Get pre-parsed appointments for this scope - O(1) lookup
      const parsedAppointments =
        preloadedData.parsedAppointmentsByScope.get(scopeKey) ?? [];

      // Parse the slot time once (this is per-slot, but we only parse once per CONCURRENT_COUNT check)
      const slotZdt = Temporal.ZonedDateTime.from(context.dateTime);
      const slotEpochMs = slotZdt.epochMilliseconds;

      // Count overlapping appointments using pre-computed epoch times - O(n) where n is appointments in scope
      // Overlap condition: start <= slotTime < end
      let overlappingCount = 0;
      for (const parsed of parsedAppointments) {
        // Check overlap
        if (
          parsed.startEpochMs <= slotEpochMs &&
          slotEpochMs < parsed.endEpochMs
        ) {
          // Check appointment type filter if specified
          if (appointmentTypeIds.length > 0) {
            const aptTypeId = parsed.appointmentTypeId;
            if (!aptTypeId || !appointmentTypeIds.includes(aptTypeId)) {
              continue;
            }
          }
          overlappingCount++;
        }
      }

      // Compare existing overlapping appointments count against the threshold
      // CONCURRENT_COUNT checks if there are already too many overlapping appointments
      return compareValue(overlappingCount, valueNumber);
    }

    case "DAILY_CAPACITY": {
      // Check if daily appointment limit is reached
      // scope: "practice", "location", or "practitioner" (determines aggregation level)
      // valueIds: optional list of appointment types to count (if empty, counts all types)
      // valueNumber: the count threshold
      if (valueNumber === undefined) {
        return false;
      }

      const scope = condition.scope;
      if (!scope) {
        throw new Error(
          "DAILY_CAPACITY condition is missing required scope. Data corruption?",
        );
      }
      const appointmentTypeIds = valueIds ?? [];

      // Use pre-computed daily capacity counts - O(k) where k is number of appointment types to sum
      // Key formats:
      // - "practice:appointmentTypeId" - practice-wide count for an appointment type
      // - "location:locationId:appointmentTypeId" - location-specific count
      // - "practitioner:practitionerId:appointmentTypeId" - practitioner-specific count

      let totalCount = 0;

      // If no specific appointment types are specified, we need to count all appointments
      // For this, we'll sum up the counts for all appointment types in the pre-computed map
      if (appointmentTypeIds.length === 0) {
        const keyPrefix =
          scope === "practice"
            ? "practice:__all__"
            : scope === "location"
              ? `location:${context.locationId}:__all__`
              : `practitioner:${context.practitionerId}:__all__`;

        totalCount = preloadedData.dailyCapacityCounts.get(keyPrefix) ?? 0;
      } else {
        // Sum up counts for each specified appointment type
        for (const typeId of appointmentTypeIds) {
          let key: string;
          if (scope === "practice") {
            key = `practice:${typeId}`;
          } else if (scope === "location") {
            key = `location:${context.locationId}:${typeId}`;
          } else {
            key = `practitioner:${context.practitionerId}:${typeId}`;
          }
          totalCount += preloadedData.dailyCapacityCounts.get(key) ?? 0;
        }
      }

      return compareValue(totalCount, valueNumber);
    }

    case "DATE_RANGE": {
      // Check if appointment date falls within a date range
      // valueIds should contain [startDate, endDate] as PlainDate ISO strings (YYYY-MM-DD)
      if (valueIds?.length !== 2) {
        return false;
      }
      const appointmentZoned = Temporal.ZonedDateTime.from(context.dateTime);
      const appointmentDate = appointmentZoned.toPlainDate();
      const startDate = Temporal.PlainDate.from(valueIds[0] ?? "");
      const endDate = Temporal.PlainDate.from(valueIds[1] ?? "");
      const inRange =
        Temporal.PlainDate.compare(appointmentDate, startDate) >= 0 &&
        Temporal.PlainDate.compare(appointmentDate, endDate) <= 0;
      return operator === "IS" ? inRange : !inRange;
    }

    case "DAY_OF_WEEK": {
      // Compare day of week (1-7, Monday=1, Sunday=7 per ISO 8601)
      const appointmentZoned = Temporal.ZonedDateTime.from(context.dateTime);
      const dayOfWeek = appointmentZoned.dayOfWeek; // ISO: 1=Monday, 7=Sunday

      const targetDayOfWeek = valueNumber;

      if (targetDayOfWeek === undefined) {
        throw new Error(
          "DAY_OF_WEEK condition is missing required valueNumber. Data corruption?",
        );
      }

      if (operator === "IS" || operator === "EQUALS") {
        return dayOfWeek === targetDayOfWeek;
      } else if (operator === "IS_NOT") {
        return dayOfWeek !== targetDayOfWeek;
      }

      return compareValue(dayOfWeek, targetDayOfWeek);
    }

    case "DAYS_AHEAD": {
      // Check how many days ahead the appointment is being booked
      if (valueNumber === undefined || !context.requestedAt) {
        return false;
      }
      const appointmentZoned = Temporal.ZonedDateTime.from(context.dateTime);
      const requestZoned = Temporal.ZonedDateTime.from(context.requestedAt);

      // Calculate days difference using PlainDate for accurate day counting
      const appointmentDate = appointmentZoned.toPlainDate();
      const requestDate = requestZoned.toPlainDate();
      const daysAhead = appointmentDate.since(requestDate).days;

      return compareValue(daysAhead, valueNumber);
    }

    case "HOURS_AHEAD": {
      // Check how many hours ahead the appointment is being booked
      if (valueNumber === undefined || !context.requestedAt) {
        return false;
      }

      const appointmentInstant = Temporal.ZonedDateTime.from(
        context.dateTime,
      ).toInstant();
      const requestedInstant = Temporal.ZonedDateTime.from(
        context.requestedAt,
      ).toInstant();
      const hoursAhead =
        (appointmentInstant.epochMilliseconds -
          requestedInstant.epochMilliseconds) /
        (60 * 60 * 1000);

      return compareValue(hoursAhead, valueNumber);
    }

    case "LOCATION": {
      // Compare location ID
      return checkIdMembership(context.locationId, valueIds);
    }

    case "PATIENT_AGE": {
      if (valueNumber === undefined || !context.patientDateOfBirth) {
        return false;
      }

      const birthDate = parsePatientBirthDate(context.patientDateOfBirth);
      const appointmentDate = Temporal.ZonedDateTime.from(
        context.dateTime,
      ).toPlainDate();
      const ageYears = getAgeYearsAtDate(birthDate, appointmentDate);
      return compareValue(ageYears, valueNumber);
    }

    case "PRACTITIONER": {
      // Compare practitioner ID
      return checkIdMembership(context.practitionerId, valueIds);
    }

    case "PRACTITIONER_TAG": {
      // Check if practitioner has a specific tag - O(1) lookup
      const practitioner = preloadedData.practitioners.get(
        context.practitionerId,
      );
      if (!practitioner?.tags || !valueIds) {
        return false;
      }
      const hasTag = valueIds.some((tag) => practitioner.tags?.includes(tag));
      return operator === "IS" ? hasTag : !hasTag;
    }

    case "TIME_RANGE": {
      // Check if appointment time falls within a time range
      // valueIds should contain [startTime, endTime] in HH:MM format
      if (valueIds?.length !== 2) {
        return false;
      }
      const appointmentZoned = Temporal.ZonedDateTime.from(context.dateTime);
      const hours = appointmentZoned.hour;
      const minutes = appointmentZoned.minute;
      const appointmentTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

      const startTime = valueIds[0] ?? "";
      const endTime = valueIds[1] ?? "";
      const inRange = appointmentTime >= startTime && appointmentTime < endTime;
      return operator === "IS" ? inRange : !inRange;
    }

    default: {
      // Unknown condition type - this indicates data corruption
      throw new Error(
        `Unknown condition type: ${conditionType as string | undefined}. ` +
          `This indicates data corruption in rule conditions.`,
      );
    }
  }
}

/**
 * Evaluate condition tree recursively.
 *
 * Recursively evaluates a condition tree starting from a given node.
 * Returns true if the tree evaluates to true (meaning the appointment should be blocked).
 *
 * Tree evaluation rules:
 * - AND: All children must be true (short-circuits on first false).
 * - NOT: Inverts the single child result.
 * - CONDITION: Evaluate the leaf condition.
 * @param nodeId Root node ID of the condition tree.
 * @param context Appointment context for evaluation.
 * @param preloadedData Pre-loaded appointment data for fast lookups (required).
 * @param conditionsMap Map of pre-loaded conditions for fast lookup (required).
 * @param allConditions Array of all pre-loaded conditions for children lookup (required).
 * @returns True if the appointment should be blocked.
 */
function evaluateConditionTree(
  nodeId: Id<"ruleConditions">,
  context: AppointmentContext,
  preloadedData: PreloadedDayData,
  conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>,
  allConditions: Doc<"ruleConditions">[],
): boolean {
  // Inner recursive function that uses the preloaded data
  const evaluateTreeInternal = (id: Id<"ruleConditions">): boolean => {
    // Use cached node from conditionsMap
    const node = conditionsMap.get(id);
    if (!node) {
      throw new Error(
        `Condition node not found in conditionsMap: ${id}. ` +
          `All conditions must be pre-loaded for evaluation.`,
      );
    }

    // If this is a leaf condition, evaluate it directly
    if (node.nodeType === "CONDITION") {
      return evaluateCondition(node, context, preloadedData);
    }

    // Get ordered children from pre-loaded conditions
    const children = allConditions
      .filter((c) => c.parentConditionId === id)
      .toSorted((a, b) => a.childOrder - b.childOrder);

    if (children.length === 0) {
      throw new Error(
        `Logical operator node has no children: ${id}. ` +
          `This indicates data corruption - AND/NOT nodes must have children.`,
      );
    }

    // Evaluate based on node type
    switch (node.nodeType) {
      case "AND": {
        // All children must be true - SHORT CIRCUIT on first false
        for (const child of children) {
          const result = evaluateTreeInternal(child._id);
          if (!result) {
            return false; // Short-circuit: if any child is false, return false
          }
        }
        return true;
      }

      case "NOT": {
        // Invert the result of the single child
        if (children.length !== 1) {
          throw new Error(
            `NOT node should have exactly 1 child, has ${children.length}: ${id}. ` +
              `This indicates data corruption.`,
          );
        }
        const child = children[0];
        if (!child) {
          return false;
        }
        const result = evaluateTreeInternal(child._id);
        return !result;
      }

      default: {
        throw new Error(
          `Unknown node type: ${node.nodeType}. ` +
            `This indicates data corruption in rule condition tree.`,
        );
      }
    }
  };

  return evaluateTreeInternal(nodeId);
}

/**
 * Check all rules in a rule set against an appointment context.
 * Returns the IDs of rules that would block the appointment, or an empty array if allowed.
 *
 * This is the main entry point for rule evaluation.
 */
export const checkRulesForAppointment = internalQuery({
  args: {
    context: appointmentContextValidator,
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const context = asAppointmentContextInput(args.context);

    // Get all enabled root rules for this rule set
    const rules = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId_isRoot_enabled", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("isRoot", true)
          .eq("enabled", true),
      )
      .collect();

    if (rules.length === 0) {
      return {
        blockedByRuleIds: [],
        isBlocked: false,
      };
    }

    // Load all conditions for this rule set (required for synchronous evaluation)
    const allConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    const conditionsMap = new Map(allConditions.map((c) => [c._id, c]));

    // Build preloaded data for condition evaluation
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", context.practiceId))
      .collect();

    // Extract date from ISO ZonedDateTime string
    const dateStr = Temporal.ZonedDateTime.from(context.dateTime)
      .toPlainDate()
      .toString();
    const preloadedData = await buildPreloadedDayData(
      ctx.db,
      context.practiceId,
      dateStr,
      args.ruleSetId,
      practitioners,
    );

    const blockedByRuleIds: Id<"ruleConditions">[] = [];

    // Evaluate each rule
    for (const rule of rules) {
      // Get the first child of the root node (the actual condition tree)
      const rootChildren = await ctx.db
        .query("ruleConditions")
        .withIndex("by_parentConditionId_childOrder", (q) =>
          q.eq("parentConditionId", rule._id),
        )
        .collect();

      if (rootChildren.length === 0) {
        // Empty rule - skip
        continue;
      }

      // A root node should have exactly one child (the top of the condition tree)
      if (rootChildren.length !== 1) {
        throw new Error(
          `Root rule node should have exactly 1 child, has ${rootChildren.length}: ${rule._id}. ` +
            `This indicates data corruption in rule structure.`,
        );
      }

      const rootChild = rootChildren[0];
      if (!rootChild) {
        continue;
      }

      // Evaluate the condition tree (synchronously with pre-loaded data)
      const isBlocked = evaluateConditionTree(
        rootChild._id,
        context,
        preloadedData,
        conditionsMap,
        allConditions,
      );

      if (isBlocked) {
        blockedByRuleIds.push(rule._id);
      }
    }

    return {
      blockedByRuleIds,
      isBlocked: blockedByRuleIds.length > 0,
    };
  },
  returns: v.object({
    blockedByRuleIds: v.array(v.id("ruleConditions")),
    isBlocked: v.boolean(),
  }),
});

/**
 * Helper query to get a human-readable description of a rule and its condition tree.
 * Useful for debugging and displaying rule information in the UI.
 */
export const getRuleDescription = internalQuery({
  args: {
    ruleId: v.id("ruleConditions"),
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get("ruleConditions", args.ruleId);
    if (!rule?.isRoot) {
      return {
        description: "Rule not found or not a root node",
        treeStructure: "",
      };
    }

    // Build condition tree recursively
    const buildConditionTree = async (
      nodeId: Id<"ruleConditions">,
    ): Promise<ConditionTreeNode | null> => {
      const node = await ctx.db.get("ruleConditions", nodeId);
      if (!node) {
        return null;
      }

      if (node.nodeType === "CONDITION") {
        // Leaf condition
        if (!node.conditionType || !node.operator) {
          return null;
        }
        return {
          conditionType: node.conditionType,
          nodeType: "CONDITION",
          operator: node.operator,
          ...(node.scope && { scope: node.scope }),
          ...(node.valueIds && { valueIds: node.valueIds }),
          ...(node.valueNumber !== undefined && {
            valueNumber: node.valueNumber,
          }),
        };
      } else {
        // Logical operator (AND/OR)
        const children = await ctx.db
          .query("ruleConditions")
          .withIndex("by_parentConditionId_childOrder", (q) =>
            q.eq("parentConditionId", nodeId),
          )
          .collect();

        const childTrees: ConditionTreeNode[] = [];
        for (const child of children) {
          const childTree = await buildConditionTree(child._id);
          if (childTree) {
            childTrees.push(childTree);
          }
        }

        // At this point, nodeType must be either "AND" or "NOT" since we already checked it's not "CONDITION"
        if (!node.nodeType) {
          return null;
        }
        return {
          children: childTrees,
          nodeType: node.nodeType,
        };
      }
    };

    // Get the first child (root of condition tree)
    const rootChildren = await ctx.db
      .query("ruleConditions")
      .withIndex("by_parentConditionId_childOrder", (q) =>
        q.eq("parentConditionId", args.ruleId),
      )
      .collect();

    if (rootChildren.length === 0 || !rootChildren[0]) {
      return {
        description: `Rule ${args.ruleId} - ${rule.enabled ? "Enabled" : "Disabled"}`,
        treeStructure: "",
      };
    }

    // Build the condition tree
    const conditionTree = await buildConditionTree(rootChildren[0]._id);
    if (!conditionTree) {
      return {
        description: `Rule ${args.ruleId} - ${rule.enabled ? "Enabled" : "Disabled"}`,
        treeStructure: "",
      };
    }

    // Convert tree to conditions
    const conditions = conditionTreeToConditions(conditionTree);

    // Fetch all entities needed for name resolution
    const allAppointmentTypes = await ctx.db
      .query("appointmentTypes")
      .collect();
    const allPractitioners = await ctx.db.query("practitioners").collect();
    const allLocations = await ctx.db.query("locations").collect();

    // Generate natural language description
    const naturalLanguageDescription = generateRuleName(
      conditions,
      allAppointmentTypes.map((at) => ({ _id: at._id, name: at.name })),
      allPractitioners.map((p) => ({ _id: p._id, name: p.name })),
      allLocations.map((l) => ({ _id: l._id, name: l.name })),
    );

    return {
      description: `Rule ${args.ruleId} - ${rule.enabled ? "Enabled" : "Disabled"}`,
      treeStructure: naturalLanguageDescription,
    };
  },
  returns: v.object({
    description: v.string(),
    treeStructure: v.string(),
  }),
});

export type {
  ConditionNode,
  ConditionOperator,
  ConditionTreeNode,
  ConditionType,
  LogicalNode,
  Scope,
} from "../lib/condition-tree.js";

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

export const scopeValidator = literalUnionValidator(SCOPES);

const CONDITION_TREE_MAX_DEPTH = 20;
const conditionTypeValidator = literalUnionValidator(CONDITION_TYPES);
const conditionOperatorValidator = literalUnionValidator(CONDITION_OPERATORS);
const logicalNodeTypeValidator = literalUnionValidator(LOGICAL_NODE_TYPES);
const conditionLeafValidator: Validator<ConditionNode, "required", string> =
  v.object({
    conditionType: conditionTypeValidator,
    nodeType: v.literal("CONDITION"),
    operator: conditionOperatorValidator,
    scope: v.optional(scopeValidator),
    valueIds: v.optional(v.array(v.string())),
    valueNumber: v.optional(v.number()),
  });

function createLogicalNodeValidator(
  childValidator: Validator<ConditionTreeNode, "required", string>,
): Validator<LogicalNode, "required", string> {
  return v.object({
    children: v.array(childValidator),
    nodeType: logicalNodeTypeValidator,
  });
}

const ruleConditionDocumentValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("ruleConditions"),
  childOrder: v.number(),
  conditionType: v.optional(conditionTypeValidator),
  copyFromId: v.optional(v.id("ruleConditions")),
  createdAt: v.int64(),
  enabled: v.optional(v.boolean()),
  isRoot: v.boolean(),
  lastModified: v.int64(),
  nodeType: v.optional(
    v.union(logicalNodeTypeValidator, v.literal("CONDITION")),
  ),
  operator: v.optional(conditionOperatorValidator),
  parentConditionId: v.optional(v.id("ruleConditions")),
  practiceId: v.id("practices"),
  ruleSetId: v.id("ruleSets"),
  scope: v.optional(scopeValidator),
  valueIds: v.optional(v.array(v.string())),
  valueNumber: v.optional(v.number()),
});

/**
 * Validator for condition tree nodes used in rule creation/updates.
 *
 * Convex validators serialize to a finite JSON tree and don't support lazy
 * references, so recursion must stay depth-bounded at the validator layer.
 * The recursive boundary is isolated in `createDepthBoundedRecursiveUnionValidator`.
 */
export const conditionTreeNodeValidator =
  createDepthBoundedRecursiveUnionValidator<ConditionNode, LogicalNode>({
    branch: createLogicalNodeValidator,
    depth: CONDITION_TREE_MAX_DEPTH,
    leaf: conditionLeafValidator,
  });

/**
 * Validate condition tree structure.
 *
 * Checks that a condition tree is well-formed before inserting it.
 * Returns validation errors, or empty array if valid.
 * @param node The condition tree node to validate.
 * @param depth Current recursion depth for infinite loop prevention.
 * @returns Array of validation error messages, or empty array if valid.
 */
export function validateConditionTree(
  node: ConditionTreeNode,
  depth = 0,
): string[] {
  const errors: string[] = [];

  // Prevent infinite recursion
  if (depth > 20) {
    errors.push("Condition tree is too deeply nested (max depth: 20)");
    return errors;
  }

  if (isConditionNode(node)) {
    // Validate leaf condition - conditionType and operator are guaranteed by type guard
    // Validate that at least one value is provided
    if (
      node.valueNumber === undefined &&
      (!node.valueIds || node.valueIds.length === 0)
    ) {
      errors.push("CONDITION node must have either valueNumber or valueIds");
    }
    if (
      (node.conditionType === "CONCURRENT_COUNT" ||
        node.conditionType === "DAILY_CAPACITY") &&
      node.scope === undefined
    ) {
      errors.push(
        `${node.conditionType} condition must define scope explicitly`,
      );
    }
    if (
      node.conditionType === "DAY_OF_WEEK" &&
      node.valueNumber === undefined
    ) {
      errors.push("DAY_OF_WEEK condition must use valueNumber");
    }
  } else if (isLogicalNode(node)) {
    // Validate logical operator - children array is guaranteed by type guard
    if (node.nodeType === "NOT" && node.children.length !== 1) {
      errors.push(
        `NOT node must have exactly 1 child, has ${node.children.length}`,
      );
    }
    if (node.nodeType === "AND" && node.children.length === 0) {
      errors.push("AND node must have at least 1 child");
    }
    // Recursively validate children
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (!child) {
        errors.push(`Child ${i} is missing`);
        continue;
      }

      const childErrors = validateConditionTree(child, depth + 1);
      errors.push(...childErrors.map((err) => `Child ${i}: ${err}`));
    }
  }

  return errors;
}

/**
 * Helper to recursively determine if a rule tree is day-invariant.
 * A tree is day-invariant if ALL leaf conditions are day-invariant.
 */
function isRuleTreeDayInvariant(
  nodeId: Id<"ruleConditions">,
  conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>,
  allConditions: Doc<"ruleConditions">[],
): boolean {
  const node = conditionsMap.get(nodeId);
  if (!node) {
    throw new Error(
      `Condition node not found during classification: ${nodeId}. ` +
        `This indicates data corruption in rule conditions.`,
    );
  }

  // If this is a leaf condition, check if it's day-invariant
  if (node.nodeType === "CONDITION") {
    return node.conditionType
      ? DAY_INVARIANT_CONDITION_TYPES.has(node.conditionType)
      : false;
  }

  // For AND/NOT nodes, check all children recursively
  const children = allConditions
    .filter((c) => c.parentConditionId === nodeId)
    .toSorted((a, b) => a.childOrder - b.childOrder);

  if (children.length === 0) {
    return false;
  }

  // A tree is day-invariant only if ALL children are day-invariant
  return children.every((child) =>
    isRuleTreeDayInvariant(child._id, conditionsMap, allConditions),
  );
}

/**
 * Helper to recursively determine if a rule tree is independent of appointment type.
 * A tree is appointment-type-independent if it contains NO APPOINTMENT_TYPE conditions.
 */
function isRuleTreeAppointmentTypeIndependent(
  nodeId: Id<"ruleConditions">,
  conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>,
  allConditions: Doc<"ruleConditions">[],
): boolean {
  const node = conditionsMap.get(nodeId);
  if (!node) {
    throw new Error(
      `Condition node not found during classification: ${nodeId}. ` +
        `This indicates data corruption in rule conditions.`,
    );
  }

  // If this is a leaf condition, check if it's NOT appointment type
  if (node.nodeType === "CONDITION") {
    return node.conditionType !== "APPOINTMENT_TYPE";
  }

  // For AND/NOT nodes, check all children recursively
  const children = allConditions
    .filter((c) => c.parentConditionId === nodeId)
    .toSorted((a, b) => a.childOrder - b.childOrder);

  if (children.length === 0) {
    return true; // Empty tree doesn't depend on appointment type
  }

  // A tree is appointment-type-independent only if ALL children are
  return children.every((child) =>
    isRuleTreeAppointmentTypeIndependent(
      child._id,
      conditionsMap,
      allConditions,
    ),
  );
}

/**
 * PERFORMANCE OPTIMIZATION: Load all rules and their condition trees for a rule set once.
 * This allows us to evaluate many appointments against the same rules without reloading them each time.
 *
 * Returns a structured object containing all rules and all their conditions pre-loaded.
 */
interface LoadedRulesForRuleSetResult {
  conditions: Doc<"ruleConditions">[];
  dayInvariantCount: number;
  rules: { _id: Id<"ruleConditions">; isDayInvariant: boolean }[];
  timeVariantCount: number;
  totalConditions: number;
}

export const loadRulesForRuleSet = internalQuery({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args): Promise<LoadedRulesForRuleSetResult> => {
    // Get all enabled root rules for this rule set
    const rules = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId_isRoot_enabled", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("isRoot", true)
          .eq("enabled", true),
      )
      .collect();

    // Load all conditions for all rules in a single pass
    // This is much more efficient than loading them recursively for each slot
    const allConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    // Build a map for quick lookup
    const conditionsMap = new Map<
      Id<"ruleConditions">,
      Doc<"ruleConditions">
    >();
    for (const condition of allConditions) {
      conditionsMap.set(condition._id, condition);
    }

    // Classify each rule as day-invariant or time-variant
    const classifiedRules = rules.map((r) => {
      const rootChildren = allConditions.filter(
        (c) => c.parentConditionId === r._id,
      );
      const firstChild = rootChildren[0];
      const isDayInvariant =
        rootChildren.length === 1 &&
        firstChild !== undefined &&
        isRuleTreeDayInvariant(firstChild._id, conditionsMap, allConditions);

      return {
        _id: r._id,
        isDayInvariant,
      };
    });

    return {
      conditions: allConditions,
      dayInvariantCount: classifiedRules.filter((r) => r.isDayInvariant).length,
      rules: classifiedRules,
      timeVariantCount: classifiedRules.filter((r) => !r.isDayInvariant).length,
      totalConditions: allConditions.length,
    };
  },
  returns: v.object({
    conditions: v.array(ruleConditionDocumentValidator),
    dayInvariantCount: v.number(),
    rules: v.array(
      v.object({
        _id: v.id("ruleConditions"),
        isDayInvariant: v.boolean(),
      }),
    ),
    timeVariantCount: v.number(),
    totalConditions: v.number(),
  }),
});

/**
 * Load rules that are independent of appointment type.
 * These rules can be evaluated and displayed even before a user selects an appointment type.
 */
export const loadAppointmentTypeIndependentRules = internalQuery({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<AppointmentTypeIndependentRulesResult> => {
    // Get all enabled root rules for this rule set
    const rules = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId_isRoot_enabled", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("isRoot", true)
          .eq("enabled", true),
      )
      .collect();

    // Load all conditions
    const allConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    // Build a map for quick lookup
    const conditionsMap = new Map<
      Id<"ruleConditions">,
      Doc<"ruleConditions">
    >();
    for (const condition of allConditions) {
      conditionsMap.set(condition._id, condition);
    }

    // Filter rules that are appointment-type-independent
    const appointmentTypeIndependentRules = rules.filter((r) => {
      const rootChildren = allConditions.filter(
        (c) => c.parentConditionId === r._id,
      );
      const firstChild = rootChildren[0];
      return (
        rootChildren.length === 1 &&
        firstChild !== undefined &&
        isRuleTreeAppointmentTypeIndependent(
          firstChild._id,
          conditionsMap,
          allConditions,
        )
      );
    });

    // Only return conditions that are part of appointment-type-independent rules
    const relevantConditionIds = new Set<Id<"ruleConditions">>();
    const addConditionAndChildren = (conditionId: Id<"ruleConditions">) => {
      relevantConditionIds.add(conditionId);
      const children = allConditions.filter(
        (c) => c.parentConditionId === conditionId,
      );
      for (const child of children) {
        addConditionAndChildren(child._id);
      }
    };

    for (const rule of appointmentTypeIndependentRules) {
      addConditionAndChildren(rule._id);
    }

    const relevantConditions = allConditions.filter((c) =>
      relevantConditionIds.has(c._id),
    );

    // Build filtered conditions map
    const filteredConditionsMap = new Map<
      Id<"ruleConditions">,
      Doc<"ruleConditions">
    >();
    for (const condition of relevantConditions) {
      filteredConditionsMap.set(condition._id, condition);
    }

    return {
      conditions: relevantConditions,
      rules: appointmentTypeIndependentRules.map((r) => ({
        _id: r._id,
        isDayInvariant: false, // Not used in this context
      })),
    };
  },
  returns: v.object({
    conditions: v.array(ruleConditionDocumentValidator),
    rules: v.array(
      v.object({
        _id: v.id("ruleConditions"),
        isDayInvariant: v.boolean(),
      }),
    ),
  }),
});

interface AppointmentTypeIndependentRulesResult {
  conditions: Doc<"ruleConditions">[];
  rules: { _id: Id<"ruleConditions">; isDayInvariant: boolean }[];
}

/**
 * PERFORMANCE OPTIMIZATION: Pre-evaluate day-invariant rules once per query execution.
 * This avoids re-evaluating rules that don't depend on time-of-day for each slot.
 * Plain TypeScript function to avoid serialization overhead.
 *
 * Note: Day-invariant rules only use conditions that don't require appointment data
 * (APPOINTMENT_TYPE, CLIENT_TYPE, DATE_RANGE, DAY_OF_WEEK, DAYS_AHEAD, LOCATION, PATIENT_AGE),
 * so we pass an empty preloaded data object.
 */
export function preEvaluateDayInvariantRulesHelper(
  context: AppointmentContext,
  rulesData: {
    conditions: Doc<"ruleConditions">[];
    conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>;
    dayInvariantCount: number;
    rules: { _id: Id<"ruleConditions">; isDayInvariant: boolean }[];
  },
  practitioners: Map<Id<"practitioners">, Doc<"practitioners">>,
): {
  blockedByRuleIds: Id<"ruleConditions">[];
  evaluatedCount: number;
} {
  const blockedRuleIds: Id<"ruleConditions">[] = [];

  // Day-invariant rules don't use DAILY_CAPACITY, CONCURRENT_COUNT, or PRACTITIONER_TAG,
  // so we create an empty preloaded data object (practitioners passed for completeness)
  const emptyPreloadedData: PreloadedDayData = {
    appointments: [],
    appointmentsByStartTime: new Map(),
    dailyCapacityCounts: new Map(),
    parsedAppointmentsByScope: new Map(),
    practitioners,
  };

  // Helper to get condition from the pre-loaded map
  const getCondition = (
    nodeId: Id<"ruleConditions">,
  ): Doc<"ruleConditions"> | undefined => {
    return rulesData.conditionsMap.get(nodeId);
  };

  // Helper to get children of a condition from the pre-loaded conditions
  const getChildren = (
    parentId: Id<"ruleConditions">,
  ): Doc<"ruleConditions">[] => {
    const filtered = rulesData.conditions.filter(
      (c) => c.parentConditionId === parentId,
    );
    return filtered.toSorted((a, b) => a.childOrder - b.childOrder);
  };

  // Recursive function to evaluate condition tree using pre-loaded data
  const evaluateTreeFromLoaded = (nodeId: Id<"ruleConditions">): boolean => {
    const node = getCondition(nodeId);
    if (!node) {
      throw new Error(`Condition node not found: ${nodeId}`);
    }

    // If this is a leaf condition, evaluate it directly
    if (node.nodeType === "CONDITION") {
      return evaluateCondition(node, context, emptyPreloadedData);
    }

    // Get ordered children
    const children = getChildren(nodeId);

    if (children.length === 0) {
      throw new Error(`Logical operator node has no children: ${nodeId}`);
    }

    // Evaluate based on node type
    switch (node.nodeType) {
      case "AND": {
        // All children must be true
        for (const child of children) {
          const result = evaluateTreeFromLoaded(child._id);
          if (!result) {
            return false; // Short-circuit
          }
        }
        return true;
      }

      case "NOT": {
        // Invert the result of the single child
        if (children.length !== 1) {
          throw new Error(`NOT node should have exactly 1 child: ${nodeId}`);
        }
        const child = children[0];
        if (!child) {
          return false;
        }
        const result = evaluateTreeFromLoaded(child._id);
        return !result;
      }

      default: {
        throw new Error(`Unknown node type: ${node.nodeType}`);
      }
    }
  };

  // Evaluate only day-invariant rules
  for (const rule of rulesData.rules) {
    if (!rule.isDayInvariant) {
      continue; // Skip time-variant rules
    }

    const rootChildren = getChildren(rule._id);

    if (rootChildren.length === 0) {
      continue; // Empty rule
    }

    if (rootChildren.length !== 1) {
      throw new Error(
        `Root rule node should have exactly 1 child: ${rule._id}`,
      );
    }

    const firstChild = rootChildren[0];
    if (!firstChild) {
      continue;
    }

    try {
      const isBlocked = evaluateTreeFromLoaded(firstChild._id);
      if (isBlocked) {
        blockedRuleIds.push(rule._id);
      }
    } catch (error) {
      console.error(`Error evaluating day-invariant rule ${rule._id}:`, error);
      throw error;
    }
  }

  return {
    blockedByRuleIds: blockedRuleIds,
    evaluatedCount: rulesData.dayInvariantCount,
  };
}

/**
 * PERFORMANCE OPTIMIZATION: Evaluate pre-loaded rules against an appointment context.
 * Uses the rules and conditions loaded by loadRulesForRuleSet to avoid redundant database queries.
 * This version also accepts pre-evaluated day-invariant rule results to skip redundant checks.
 * Plain TypeScript function to avoid serialization overhead.
 */
export function evaluateLoadedRulesHelper(
  context: AppointmentContext,
  rulesData: {
    conditions: Doc<"ruleConditions">[];
    conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>;
    rules: { _id: Id<"ruleConditions">; isDayInvariant: boolean }[];
  },
  preloadedData: PreloadedDayData,
  preEvaluatedDayRules?: {
    blockedByRuleIds: Id<"ruleConditions">[];
    evaluatedCount: number;
  },
): {
  blockedByRuleIds: Id<"ruleConditions">[];
  dayInvariantSkipped: number;
  isBlocked: boolean;
  timeVariantEvaluated: number;
} {
  const blockedByRuleIds: Id<"ruleConditions">[] = [];

  // Start with pre-evaluated day-invariant rules if provided
  if (preEvaluatedDayRules) {
    blockedByRuleIds.push(...preEvaluatedDayRules.blockedByRuleIds);
  }

  // Helper to get condition from the pre-loaded map
  const getCondition = (
    nodeId: Id<"ruleConditions">,
  ): Doc<"ruleConditions"> | undefined => {
    return rulesData.conditionsMap.get(nodeId);
  };

  // Helper to get children of a condition from the pre-loaded conditions
  const getChildren = (
    parentId: Id<"ruleConditions">,
  ): Doc<"ruleConditions">[] => {
    const filtered = rulesData.conditions.filter(
      (c) => c.parentConditionId === parentId,
    );
    return filtered.toSorted((a, b) => a.childOrder - b.childOrder);
  };

  // Recursive function to evaluate condition tree using pre-loaded data
  const evaluateTreeFromLoaded = (nodeId: Id<"ruleConditions">): boolean => {
    const node = getCondition(nodeId);
    if (!node) {
      throw new Error(
        `Condition node not found: ${nodeId}. ` +
          `This indicates data corruption - referenced node does not exist.`,
      );
    }

    // If this is a leaf condition, evaluate it directly
    if (node.nodeType === "CONDITION") {
      return evaluateCondition(node, context, preloadedData);
    }

    // Get ordered children
    const children = getChildren(nodeId);

    if (children.length === 0) {
      throw new Error(
        `Logical operator node has no children: ${nodeId}. ` +
          `This indicates data corruption - AND/NOT nodes must have children.`,
      );
    }

    // Evaluate based on node type
    switch (node.nodeType) {
      case "AND": {
        // All children must be true
        for (const child of children) {
          const result = evaluateTreeFromLoaded(child._id);
          if (!result) {
            return false; // Short-circuit: if any child is false, return false
          }
        }
        return true;
      }

      case "NOT": {
        // Invert the result of the single child
        if (children.length !== 1) {
          throw new Error(
            `NOT node should have exactly 1 child, has ${children.length}: ${nodeId}. ` +
              `This indicates data corruption.`,
          );
        }
        const child = children[0];
        if (!child) {
          return false;
        }
        const result = evaluateTreeFromLoaded(child._id);
        return !result;
      }

      default: {
        throw new Error(
          `Unknown node type: ${node.nodeType}. ` +
            `This indicates data corruption in rule condition tree.`,
        );
      }
    }
  };

  // Evaluate only time-variant rules (day-invariant rules were pre-evaluated)
  let timeVariantEvaluated = 0;
  for (const rule of rulesData.rules) {
    // Skip day-invariant rules if they were pre-evaluated
    if (rule.isDayInvariant && preEvaluatedDayRules) {
      continue;
    }

    // Get the first child of the root node (the actual condition tree)
    const rootChildren = getChildren(rule._id);

    timeVariantEvaluated++;

    if (rootChildren.length === 0) {
      // Empty rule - skip
      continue;
    }

    // A root node should have exactly one child (the top of the condition tree)
    if (rootChildren.length !== 1) {
      throw new Error(
        `Root rule node should have exactly 1 child, has ${rootChildren.length}: ${rule._id}. ` +
          `This indicates data corruption in rule structure.`,
      );
    }

    const rootChild = rootChildren[0];
    if (!rootChild) {
      continue;
    }

    // Evaluate the condition tree using pre-loaded data
    const isBlocked = evaluateTreeFromLoaded(rootChild._id);

    if (isBlocked) {
      blockedByRuleIds.push(rule._id);
      // EARLY TERMINATION: Stop evaluating once we find a blocking rule
      // No need to check remaining rules since we already know the slot is blocked
      break;
    }
  }

  return {
    blockedByRuleIds,
    dayInvariantSkipped: preEvaluatedDayRules?.evaluatedCount ?? 0,
    isBlocked: blockedByRuleIds.length > 0,
    timeVariantEvaluated,
  };
}

import type { PostHog, Properties } from "posthog-js";

import type { Id } from "@/convex/_generated/dataModel";
import type { BookingSessionStepName } from "@/lib/booking-session-steps";

import {
  getBookingSessionStepGroup,
  getBookingSessionStepKind,
} from "@/lib/booking-session-steps";

import type { BookingSessionState } from "../components/booking-wizard/types";

export type BookingAnalyticsEventName =
  | "booking_appointment_created"
  | "booking_flow_reset"
  | "booking_flow_started"
  | "booking_step_back"
  | "booking_step_viewed";

interface BookingAnalyticsScope {
  organizationSlug: string;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets">;
}

type BookingBranch = "existing-patient" | "new-patient";

export function buildBookingAnalyticsScopeProperties({
  organizationSlug,
  practiceId,
  ruleSetId,
}: BookingAnalyticsScope): Properties {
  return {
    organization_slug: organizationSlug,
    practice_id: practiceId,
    ...(ruleSetId === undefined ? {} : { rule_set_id: ruleSetId }),
  };
}

export function buildBookingStepAnalyticsProperties({
  organizationSlug,
  practiceId,
  ruleSetId,
  state,
}: BookingAnalyticsScope & {
  ruleSetId: Id<"ruleSets">;
  state: BookingSessionState;
}): Properties {
  const branch = getBookingBranch(state);

  return {
    ...buildBookingAnalyticsScopeProperties({
      organizationSlug,
      practiceId,
      ruleSetId,
    }),
    step: state.step,
    step_group: getBookingSessionStepGroup(state.step),
    step_kind: getBookingSessionStepKind(state.step),
    ...(branch === undefined ? {} : { branch }),
    ...("insuranceType" in state
      ? { insurance_type: state.insuranceType }
      : {}),
    ...("locationLineageKey" in state
      ? { location_lineage_key: state.locationLineageKey }
      : {}),
    ...("practitionerLineageKey" in state
      ? { practitioner_lineage_key: state.practitionerLineageKey }
      : {}),
  };
}

export function buildBookingStepTargetAnalyticsProperties(
  step: BookingSessionStepName,
): Properties {
  return {
    target_step: step,
    target_step_group: getBookingSessionStepGroup(step),
    target_step_kind: getBookingSessionStepKind(step),
  };
}

export function captureBookingAnalyticsEvent(
  posthog: PostHog,
  eventName: BookingAnalyticsEventName,
  properties: Properties,
): void {
  if (
    !import.meta.env["VITE_PUBLIC_POSTHOG_KEY"] ||
    (import.meta.env.DEV && !import.meta.env["VITE_ENABLE_POSTHOG_IN_DEV"])
  ) {
    return;
  }

  posthog.capture(eventName, properties);
}

export function getBookingStepAnalyticsKey({
  organizationSlug,
  practiceId,
  ruleSetId,
  state,
}: BookingAnalyticsScope & {
  ruleSetId: Id<"ruleSets">;
  state: BookingSessionState;
}): string {
  return [
    organizationSlug,
    practiceId,
    ruleSetId,
    state.step,
    getBookingBranch(state) ?? "unknown-branch",
  ].join(":");
}

function getBookingBranch(
  state: BookingSessionState,
): BookingBranch | undefined {
  if ("isNewPatient" in state) {
    return state.isNewPatient ? "new-patient" : "existing-patient";
  }

  if (state.step.startsWith("new-")) {
    return "new-patient";
  }

  if (state.step.startsWith("existing-")) {
    return "existing-patient";
  }

  return undefined;
}

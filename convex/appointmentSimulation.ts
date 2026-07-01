import { type Infer, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

export const appointmentSimulationKindValidator = v.union(
  v.literal("draft"),
  v.literal("activation-reassignment"),
);

export interface AppointmentReplacementState {
  appointmentTypeLineageKey: AppointmentDoc["appointmentTypeLineageKey"];
  appointmentTypeTitle: AppointmentDoc["appointmentTypeTitle"];
  bookingIdentityId: AppointmentDoc["bookingIdentityId"] | undefined;
  cancelledAt: AppointmentDoc["cancelledAt"] | undefined;
  cancelledByPhoneBookingIdentityId:
    | AppointmentDoc["cancelledByPhoneBookingIdentityId"]
    | undefined;
  cancelledByUserId: AppointmentDoc["cancelledByUserId"] | undefined;
  color: AppointmentDoc["color"];
  end: AppointmentDoc["end"];
  locationLineageKey: AppointmentDoc["locationLineageKey"];
  occupancyScope: AppointmentDoc["occupancyScope"];
  patientId: AppointmentDoc["patientId"] | undefined;
  phoneBookingIdentityId: AppointmentDoc["phoneBookingIdentityId"] | undefined;
  practiceId: AppointmentDoc["practiceId"];
  seriesId: AppointmentDoc["seriesId"] | undefined;
  seriesStepId: AppointmentDoc["seriesStepId"] | undefined;
  seriesStepIndex: AppointmentDoc["seriesStepIndex"] | undefined;
  smiley: AppointmentDoc["smiley"] | undefined;
  start: AppointmentDoc["start"];
  title: AppointmentDoc["title"];
  userId: AppointmentDoc["userId"] | undefined;
}

export type AppointmentSimulationKind = Infer<
  typeof appointmentSimulationKindValidator
>;

type AppointmentDoc = Doc<"appointments">;

type SimulationAppointmentLike = Pick<
  Doc<"appointments">,
  "isSimulation" | "reassignmentSourceVacationLineageKey" | "simulationKind"
>;

export function appointmentReplacementInsertFields(
  appointment: Doc<"appointments">,
  overrides: Partial<AppointmentReplacementState> = {},
  options?: { includeSeriesMembership: boolean },
) {
  const state = appointmentReplacementState(appointment, overrides);
  const includeSeriesMembership = options?.includeSeriesMembership ?? true;
  return {
    appointmentTypeLineageKey: state.appointmentTypeLineageKey,
    appointmentTypeTitle: state.appointmentTypeTitle,
    ...(state.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: state.bookingIdentityId }),
    ...(state.cancelledAt === undefined
      ? {}
      : { cancelledAt: state.cancelledAt }),
    ...(state.cancelledByPhoneBookingIdentityId === undefined
      ? {}
      : {
          cancelledByPhoneBookingIdentityId:
            state.cancelledByPhoneBookingIdentityId,
        }),
    ...(state.cancelledByUserId === undefined
      ? {}
      : { cancelledByUserId: state.cancelledByUserId }),
    ...(state.color === undefined ? {} : { color: state.color }),
    end: state.end,
    locationLineageKey: state.locationLineageKey,
    occupancyScope: state.occupancyScope,
    ...(state.patientId === undefined ? {} : { patientId: state.patientId }),
    ...(state.phoneBookingIdentityId === undefined
      ? {}
      : { phoneBookingIdentityId: state.phoneBookingIdentityId }),
    practiceId: state.practiceId,
    ...(includeSeriesMembership && state.seriesId !== undefined
      ? { seriesId: state.seriesId }
      : {}),
    ...(includeSeriesMembership && state.seriesStepId !== undefined
      ? { seriesStepId: state.seriesStepId }
      : {}),
    ...(includeSeriesMembership && state.seriesStepIndex !== undefined
      ? { seriesStepIndex: state.seriesStepIndex }
      : {}),
    ...(state.smiley === undefined ? {} : { smiley: state.smiley }),
    start: state.start,
    title: state.title,
    ...(state.userId === undefined ? {} : { userId: state.userId }),
  };
}

export function appointmentReplacementState(
  appointment: Doc<"appointments">,
  overrides: Partial<AppointmentReplacementState> = {},
): AppointmentReplacementState {
  return {
    appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
    appointmentTypeTitle: appointment.appointmentTypeTitle,
    bookingIdentityId: appointment.bookingIdentityId,
    cancelledAt: appointment.cancelledAt,
    cancelledByPhoneBookingIdentityId:
      appointment.cancelledByPhoneBookingIdentityId,
    cancelledByUserId: appointment.cancelledByUserId,
    color: appointment.color,
    end: appointment.end,
    locationLineageKey: appointment.locationLineageKey,
    occupancyScope: appointment.occupancyScope,
    patientId: appointment.patientId,
    phoneBookingIdentityId: appointment.phoneBookingIdentityId,
    practiceId: appointment.practiceId,
    seriesId: appointment.seriesId,
    seriesStepId: appointment.seriesStepId,
    seriesStepIndex: appointment.seriesStepIndex,
    smiley: appointment.smiley,
    start: appointment.start,
    title: appointment.title,
    userId: appointment.userId,
    ...overrides,
  };
}

export function appointmentReplacementStatesEqual(
  left: AppointmentReplacementState,
  right: AppointmentReplacementState,
  options?: { compareSeriesMembership: boolean },
): boolean {
  const compareSeriesMembership = options?.compareSeriesMembership ?? true;
  return (
    left.appointmentTypeLineageKey === right.appointmentTypeLineageKey &&
    left.appointmentTypeTitle === right.appointmentTypeTitle &&
    left.bookingIdentityId === right.bookingIdentityId &&
    left.cancelledAt === right.cancelledAt &&
    left.cancelledByPhoneBookingIdentityId ===
      right.cancelledByPhoneBookingIdentityId &&
    left.cancelledByUserId === right.cancelledByUserId &&
    left.color === right.color &&
    left.end === right.end &&
    left.locationLineageKey === right.locationLineageKey &&
    appointmentOccupancyScopesEqual(
      left.occupancyScope,
      right.occupancyScope,
    ) &&
    left.patientId === right.patientId &&
    left.phoneBookingIdentityId === right.phoneBookingIdentityId &&
    left.practiceId === right.practiceId &&
    (!compareSeriesMembership ||
      (left.seriesId === right.seriesId &&
        left.seriesStepId === right.seriesStepId &&
        left.seriesStepIndex === right.seriesStepIndex)) &&
    left.smiley === right.smiley &&
    left.start === right.start &&
    left.title === right.title &&
    left.userId === right.userId
  );
}

export function isActivationBoundSimulation(
  appointment: SimulationAppointmentLike,
): boolean {
  if (appointment.isSimulation !== true) {
    return false;
  }

  if (appointment.simulationKind === "activation-reassignment") {
    return true;
  }

  return appointment.reassignmentSourceVacationLineageKey !== undefined;
}

function appointmentOccupancyScopesEqual(
  left: AppointmentReplacementState["occupancyScope"],
  right: AppointmentReplacementState["occupancyScope"],
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "practitioner" && right.kind === "practitioner") {
    return left.practitionerLineageKey === right.practitionerLineageKey;
  }

  if (left.kind === "resource" && right.kind === "resource") {
    return left.calendarResourceColumn === right.calendarResourceColumn;
  }

  return true;
}

import type { Id } from "../../../convex/_generated/dataModel";

export interface AppointmentOwnerRefs {
  bookingIdentityId?: Id<"bookingIdentities">;
  patientId?: Id<"patients">;
  phoneBookingIdentityId?: Id<"phoneBookingIdentities">;
  userId?: Id<"users">;
}

export function getAppointmentOwnerRefs(
  source: AppointmentOwnerRefs,
): AppointmentOwnerRefs {
  return {
    ...(source.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: source.bookingIdentityId }),
    ...(source.patientId === undefined ? {} : { patientId: source.patientId }),
    ...(source.phoneBookingIdentityId === undefined
      ? {}
      : { phoneBookingIdentityId: source.phoneBookingIdentityId }),
    ...(source.userId === undefined ? {} : { userId: source.userId }),
  };
}

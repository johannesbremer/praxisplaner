import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type {
  CalendarAppointmentRecord,
  CalendarBlockedSlotRecord,
} from "../../../src/components/calendar/types";

import { createCalendarPlacement } from "../../../lib/calendar-occupancy";

export function buildAppointmentPlacement(
  args:
    | {
        calendarResourceColumn: "ekg" | "labor";
        locationLineageKey: LocationLineageKey;
      }
    | {
        calendarResourceColumn?: undefined;
        locationLineageKey: LocationLineageKey;
        practitionerLineageKey: PractitionerLineageKey;
      },
): CalendarAppointmentRecord["placement"] {
  return createCalendarPlacement({
    locationLineageKey: args.locationLineageKey,
    occupancyScope:
      args.calendarResourceColumn === undefined
        ? {
            kind: "practitioner",
            practitionerLineageKey: args.practitionerLineageKey,
          }
        : {
            calendarResourceColumn: args.calendarResourceColumn,
            kind: "resource",
          },
  });
}

export function buildBlockedSlotPlacement(args: {
  calendarResourceColumn?: "ekg" | "labor";
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
}): CalendarBlockedSlotRecord["placement"] {
  if (
    args.calendarResourceColumn === undefined &&
    args.practitionerLineageKey === undefined
  ) {
    throw new Error(
      "Calendar blocked-slot test records require a practitioner or resource scope.",
    );
  }

  if (args.calendarResourceColumn !== undefined) {
    return createCalendarPlacement({
      locationLineageKey: args.locationLineageKey,
      occupancyScope: {
        calendarResourceColumn: args.calendarResourceColumn,
        kind: "resource",
      },
    });
  }

  const { practitionerLineageKey } = args;
  if (practitionerLineageKey === undefined) {
    throw new Error(
      "Calendar blocked-slot test records require a practitioner scope.",
    );
  }

  return createCalendarPlacement({
    locationLineageKey: args.locationLineageKey,
    occupancyScope: {
      kind: "practitioner",
      practitionerLineageKey,
    },
  });
}

export function buildCalendarAppointmentRecord(args: {
  _id: Id<"appointments">;
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  appointmentTypeTitle?: string;
  calendarResourceColumn?: "ekg" | "labor";
  end: CalendarAppointmentRecord["end"];
  locationLineageKey?: LocationLineageKey;
  placement?: CalendarAppointmentRecord["placement"];
  practiceId: Id<"practices">;
  practitionerLineageKey?: PractitionerLineageKey;
  smiley?: CalendarAppointmentRecord["smiley"];
  start: CalendarAppointmentRecord["start"];
  title: string;
}): CalendarAppointmentRecord {
  const placement =
    args.placement ??
    buildAppointmentPlacement({
      ...(args.calendarResourceColumn === undefined
        ? {}
        : { calendarResourceColumn: args.calendarResourceColumn }),
      locationLineageKey:
        args.locationLineageKey ??
        (() => {
          throw new Error(
            "Calendar appointment test records require a location.",
          );
        })(),
      ...(args.practitionerLineageKey === undefined
        ? {}
        : { practitionerLineageKey: args.practitionerLineageKey }),
    });
  return {
    _creationTime: 0,
    _id: args._id,
    appointmentTypeLineageKey: args.appointmentTypeLineageKey,
    appointmentTypeTitle: args.appointmentTypeTitle ?? "Checkup",
    color: "blue",
    createdAt: 0n,
    end: args.end,
    lastModified: 0n,
    placement,
    practiceId: args.practiceId,
    ...(args.smiley === undefined ? {} : { smiley: args.smiley }),
    start: args.start,
    title: args.title,
  };
}

export function buildCalendarBlockedSlotRecord(args: {
  _id: Id<"blockedSlots">;
  calendarResourceColumn?: "ekg" | "labor";
  end: CalendarBlockedSlotRecord["end"];
  locationLineageKey?: LocationLineageKey;
  placement?: CalendarBlockedSlotRecord["placement"];
  practiceId: Id<"practices">;
  practitionerLineageKey?: PractitionerLineageKey;
  start: CalendarBlockedSlotRecord["start"];
  title?: string;
}): CalendarBlockedSlotRecord {
  const placement =
    args.placement ??
    buildBlockedSlotPlacement({
      locationLineageKey:
        args.locationLineageKey ??
        (() => {
          throw new Error(
            "Calendar blocked-slot test records require a location.",
          );
        })(),
      ...(args.calendarResourceColumn === undefined
        ? {}
        : { calendarResourceColumn: args.calendarResourceColumn }),
      ...(args.practitionerLineageKey === undefined
        ? {}
        : { practitionerLineageKey: args.practitionerLineageKey }),
    });
  return {
    _creationTime: 0,
    _id: args._id,
    createdAt: 0n,
    end: args.end,
    lastModified: 0n,
    placement,
    practiceId: args.practiceId,
    start: args.start,
    title: args.title ?? "Blocked",
  };
}

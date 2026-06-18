import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AppointmentResult,
  BlockedSlotResult,
} from "../../../convex/appointments";
import type {
  AppointmentTypeLineageKey,
  LocationLineageKey,
  PractitionerLineageKey,
} from "../../../convex/identity";
import type {
  AppointmentOccupancyScope as SharedAppointmentOccupancyScope,
  BlockedSlotOccupancyScope as SharedBlockedSlotOccupancyScope,
  CalendarColumnScope as SharedCalendarColumnScope,
  CalendarPlacement as SharedCalendarPlacement,
} from "../../../lib/calendar-occupancy";
import type {
  PatientInfo,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
} from "../../types";

export type AppointmentOccupancyScope =
  SharedAppointmentOccupancyScope<PractitionerLineageKey>;

export type BlockedSlotOccupancyScope =
  SharedBlockedSlotOccupancyScope<PractitionerLineageKey>;

export interface CalendarAppointmentLayout {
  column: CalendarColumnId;
  duration: number;
  id: string;
  record: CalendarAppointmentRecord;
  startTime: string;
}

export type CalendarAppointmentPlacement = SharedCalendarPlacement<
  LocationLineageKey,
  SharedAppointmentOccupancyScope<PractitionerLineageKey>
>;

export type CalendarAppointmentRecord = Omit<
  AppointmentResult,
  | "appointmentTypeId"
  | "appointmentTypeLineageKey"
  | "locationId"
  | "locationLineageKey"
  | "occupancyScope"
  | "practitionerId"
> & {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  placement: CalendarAppointmentPlacement;
};

export interface CalendarAppointmentView {
  color: string;
  layout: CalendarAppointmentLayout;
  patientName?: string;
}

export interface CalendarBlockedSlotEditorRecord {
  end: CalendarBlockedSlotRecord["end"];
  locationId: Id<"locations">;
  practiceId: Id<"practices">;
  practitionerId?: Id<"practitioners">;
  start: CalendarBlockedSlotRecord["start"];
  title: string;
}

export type CalendarBlockedSlotPlacement = SharedCalendarPlacement<
  LocationLineageKey,
  SharedBlockedSlotOccupancyScope<PractitionerLineageKey>
>;

export type CalendarBlockedSlotRecord = Omit<
  BlockedSlotResult,
  "locationId" | "locationLineageKey" | "occupancyScope" | "practitionerId"
> & {
  placement: CalendarBlockedSlotPlacement;
};

export interface CalendarColumn {
  id: CalendarColumnId;
  isAppointmentTypeUnavailable?: boolean;
  isDragDisabled?: boolean;
  isMuted?: boolean;
  isUnavailable?: boolean;
  title: string;
}

export type CalendarColumnId =
  SharedCalendarColumnScope<PractitionerLineageKey>;

export type CalendarColumnScope =
  SharedCalendarColumnScope<PractitionerLineageKey>;

export interface WorkingPractitioner {
  endTime: string;
  lineageKey: PractitionerLineageKey;
  name: string;
  startTime: string;
}

/**
 * Data required to create an appointment.
 * Used when patient selection is deferred (e.g., when creating via grid click without a patient selected).
 */
export interface NewCalendarProps {
  canManageCalendarPlanning?: boolean | undefined;
  locationName?: string | undefined;
  onAppointmentCreated?:
    | ((appointmentId: Id<"appointments">) => void)
    | undefined;
  onClearAppointmentTypeSelection?: (() => void) | undefined;
  onDateChange?: ((date: Temporal.PlainDate) => void) | undefined;
  onLocationResolved?:
    | ((locationId: Id<"locations">, locationName: string) => void)
    | undefined;
  onPatientRequired?:
    | ((params: {
        appointmentTypeLineageKey: AppointmentTypeLineageKey;
        isSimulation: boolean;
        placement: CalendarAppointmentPlacement;
        practiceId: Id<"practices">;
        start: string;
        title: string;
      }) => void)
    | undefined;

  /**
   * Pending appointment title set by the sidebar modal before manual placement.
   * Used when creating appointments via calendar click.
   */
  pendingAppointmentTitle?: string | undefined;

  /**
   * Optional ref to the scroll container for auto-scroll during drag operations
   * and scrolling to appointments when selected from the sidebar.
   */
  onUpdateSimulatedContext?:
    | ((context: SchedulingSimulatedContext) => void)
    | undefined;

  patient?: PatientInfo | undefined;
  practiceId: Id<"practices">;
  ruleSetId: SchedulingRuleSetId;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null> | undefined;
  selectedAppointmentTypeId?: Id<"appointmentTypes"> | undefined;
  selectedLocationId?: Id<"locations"> | undefined;
  showGdtAlert?: boolean | undefined;
  simulatedContext?: SchedulingSimulatedContext | undefined;
  simulationDate?: Temporal.PlainDate | undefined;
}

export const SLOT_DURATION = 5; // minutes

export const CALENDAR_APPOINTMENT_COLOR_CLASSES = {
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  cyan: "bg-cyan-500",
  emerald: "bg-emerald-500",
  fuchsia: "bg-fuchsia-500",
  indigo: "bg-indigo-500",
  rose: "bg-rose-500",
  slate: "bg-slate-500",
  teal: "bg-teal-500",
  violet: "bg-violet-500",
} as const;

export const APPOINTMENT_COLORS = Object.values(
  CALENDAR_APPOINTMENT_COLOR_CLASSES,
);

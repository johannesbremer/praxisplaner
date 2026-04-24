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
  PatientInfo,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
} from "../../types";

export interface CalendarAppointmentLayout {
  column: CalendarColumnId;
  duration: number;
  id: string;
  record: CalendarAppointmentRecord;
  startTime: string;
}

export type CalendarAppointmentRecord = Omit<
  AppointmentResult,
  | "appointmentTypeId"
  | "appointmentTypeLineageKey"
  | "locationId"
  | "locationLineageKey"
  | "practitionerId"
  | "practitionerLineageKey"
> & {
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
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

export type CalendarBlockedSlotRecord = Omit<
  BlockedSlotResult,
  | "locationId"
  | "locationLineageKey"
  | "practitionerId"
  | "practitionerLineageKey"
> & {
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey?: PractitionerLineageKey;
};

export interface CalendarColumn {
  id: CalendarColumnId;
  isAppointmentTypeUnavailable?: boolean;
  isDragDisabled?: boolean;
  isMuted?: boolean;
  isUnavailable?: boolean;
  title: string;
}

export type CalendarColumnId = "ekg" | "labor" | PractitionerLineageKey;

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
  locationName?: string | undefined;
  onClearAppointmentTypeSelection?: (() => void) | undefined;
  onDateChange?: ((date: Temporal.PlainDate) => void) | undefined;
  onLocationResolved?:
    | ((locationId: Id<"locations">, locationName: string) => void)
    | undefined;
  onPatientRequired?:
    | ((params: {
        appointmentTypeLineageKey: AppointmentTypeLineageKey;
        isSimulation: boolean;
        locationLineageKey: LocationLineageKey;
        practiceId: Id<"practices">;
        practitionerLineageKey?: PractitionerLineageKey;
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

export const APPOINTMENT_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-red-500",
  "bg-yellow-500",
  "bg-indigo-500",
  "bg-gray-500",
];

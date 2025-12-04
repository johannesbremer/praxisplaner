import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type {
  PatientInfo,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
} from "../../types";

export interface Appointment {
  color: string;
  column: string; // Resource ID (practitioner ID or "ekg" / "labor")
  convexId?: Id<"appointments">; // Original Convex ID for real appointments
  duration: number; // in minutes
  id: string;
  isSimulation: boolean;
  patientName?: string; // Patient name for display
  replacesAppointmentId?: Id<"appointments"> | null;
  resource?: {
    appointmentTypeId?: Doc<"appointments">["appointmentTypeId"];
    isSimulation?: boolean;
    locationId?: Doc<"appointments">["locationId"];
    patientId?: Doc<"appointments">["patientId"];
    practitionerId?: Doc<"appointments">["practitionerId"];
  };
  startTime: string;
  title: string;
}

/**
 * Data required to create an appointment.
 * Used when patient selection is deferred (e.g., when creating via grid click without a patient selected).
 */
export interface NewCalendarProps {
  locationSlug?: string | undefined;
  onDateChange?: ((date: Temporal.PlainDate) => void) | undefined;
  onLocationResolved?:
    | ((locationId: Id<"locations">, locationName: string) => void)
    | undefined;

  /**
   * Called when an appointment creation is attempted without a patient selected.
   * The component should show a patient selection modal and then call
   * `runCreateAppointment` with the pending data plus the selected patient.
   */
  onPatientRequired?:
    | ((pendingData: PendingAppointmentData) => void)
    | undefined;
  onUpdateSimulatedContext?:
    | ((context: SchedulingSimulatedContext) => void)
    | undefined;
  patient?: PatientInfo | undefined;
  practiceId?: Id<"practices"> | undefined;
  ruleSetId?: SchedulingRuleSetId | undefined;
  selectedAppointmentTypeId?: Id<"appointmentTypes"> | undefined;
  selectedLocationId?: Id<"locations"> | undefined;
  showGdtAlert?: boolean | undefined;
  simulatedContext?: SchedulingSimulatedContext | undefined;
  simulationDate?: Temporal.PlainDate | undefined;
}

export interface PendingAppointmentData {
  appointmentTypeId: Id<"appointmentTypes">;
  end: string;
  isSimulation: boolean;
  locationId: Id<"locations">;
  practiceId: Id<"practices">;
  practitionerId?: Id<"practitioners">;
  start: string;
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

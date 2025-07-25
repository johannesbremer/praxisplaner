import type { Id } from "@/convex/_generated/dataModel";

import type { LocalAppointment } from "../utils/local-appointments";

import { PraxisCalendar } from "./praxis-calendar";

interface MedicalStaffViewProps {
  dateRange: { end: string; start: string };
  localAppointments?: LocalAppointment[];
  onCreateLocalAppointment?: (
    appointment: Omit<LocalAppointment, "id" | "isLocal">,
  ) => void;
  onSlotClick?: (slot: {
    blockedByRuleId?: Id<"rules"> | undefined;
    duration: number;
    locationId?: Id<"locations"> | undefined;
    practitionerId: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
    status: "AVAILABLE" | "BLOCKED";
  }) => void;
  onUpdateSimulatedContext?: (context: {
    appointmentType: string;
    patient: { isNew: boolean };
  }) => void;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets"> | undefined;
  simulatedContext: {
    appointmentType: string;
    patient: { isNew: boolean };
  };
}

export function MedicalStaffView({
  dateRange,
  localAppointments = [],
  onCreateLocalAppointment,
  onSlotClick,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Will be used later
  onUpdateSimulatedContext: _onUpdateSimulatedContext,
  practiceId,
  ruleSetId,
  simulatedContext,
}: MedicalStaffViewProps) {
  // Extract the simulation date from dateRange
  const simulationDate = new Date(dateRange.start);

  // Show the Terminkalender (appointment calendar) for medical staff
  return (
    <div className="h-full w-full overflow-auto p-6">
      <PraxisCalendar
        localAppointments={localAppointments}
        onCreateLocalAppointment={onCreateLocalAppointment}
        onSlotClick={onSlotClick}
        practiceId={practiceId}
        ruleSetId={ruleSetId}
        simulatedContext={simulatedContext}
        simulationDate={simulationDate}
      />
    </div>
  );
}

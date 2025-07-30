import type { Id } from "@/convex/_generated/dataModel";

import type { LocalAppointment } from "../utils/local-appointments";

import { MedicalStaffView } from "./medical-staff-view";
import { XDRDevice } from "./xdr-device";

interface MedicalStaffDisplayProps {
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
    locationId?: Id<"locations"> | undefined;
    patient: { isNew: boolean };
  }) => void;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets"> | undefined;
  simulatedContext: {
    appointmentType: string;
    locationId?: Id<"locations"> | undefined;
    patient: { isNew: boolean };
  };
}

export function MedicalStaffDisplay({
  dateRange,
  localAppointments = [],
  onCreateLocalAppointment,
  onSlotClick,
  onUpdateSimulatedContext,
  practiceId,
  ruleSetId,
  simulatedContext,
}: MedicalStaffDisplayProps) {
  return (
    <div className="w-full px-6">
      <XDRDevice>
        <MedicalStaffView
          dateRange={dateRange}
          {...(onSlotClick && { onSlotClick })}
          {...(onUpdateSimulatedContext && { onUpdateSimulatedContext })}
          localAppointments={localAppointments}
          {...(onCreateLocalAppointment && { onCreateLocalAppointment })}
          practiceId={practiceId}
          {...(ruleSetId && { ruleSetId })}
          simulatedContext={simulatedContext}
        />
      </XDRDevice>
    </div>
  );
}

import type { Id } from "@/convex/_generated/dataModel";

import { MedicalStaffView } from "./medical-staff-view";
import { XDRDevice } from "./xdr-device";

interface MedicalStaffDisplayProps {
  dateRange: { end: string; start: string };
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

export function MedicalStaffDisplay({
  dateRange,
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
          practiceId={practiceId}
          ruleSetId={ruleSetId}
          simulatedContext={simulatedContext}
        />
      </XDRDevice>
    </div>
  );
}

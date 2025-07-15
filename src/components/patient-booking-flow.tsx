import type { Id } from "@/convex/_generated/dataModel";

import { PatientFocusedView } from "./patient-focused-view";
import { SmartphoneDevice } from "./smartphone-device";

interface PatientBookingFlowProps {
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

export function PatientBookingFlow({
  dateRange,
  onSlotClick,
  onUpdateSimulatedContext,
  practiceId,
  ruleSetId,
  simulatedContext,
}: PatientBookingFlowProps) {
  return (
    <div className="flex justify-center">
      <SmartphoneDevice>
        <PatientFocusedView
          dateRange={dateRange}
          {...(onSlotClick && { onSlotClick })}
          {...(onUpdateSimulatedContext && { onUpdateSimulatedContext })}
          practiceId={practiceId}
          ruleSetId={ruleSetId}
          simulatedContext={simulatedContext}
        />
      </SmartphoneDevice>
    </div>
  );
}

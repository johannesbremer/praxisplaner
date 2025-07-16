import type { Id } from "@/convex/_generated/dataModel";

import { PatientFocusedView } from "./patient-focused-view";

interface MedicalStaffViewProps {
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

export function MedicalStaffView({
  dateRange,
  onSlotClick,
  onUpdateSimulatedContext,
  practiceId,
  ruleSetId,
  simulatedContext,
}: MedicalStaffViewProps) {
  // Initially using the same content as patient view
  // This can be customized later for medical staff specific features
  return (
    <div className="h-full w-full overflow-auto">
      <PatientFocusedView
        dateRange={dateRange}
        {...(onSlotClick && { onSlotClick })}
        {...(onUpdateSimulatedContext && { onUpdateSimulatedContext })}
        practiceId={practiceId}
        ruleSetId={ruleSetId}
        simulatedContext={simulatedContext}
      />
    </div>
  );
}

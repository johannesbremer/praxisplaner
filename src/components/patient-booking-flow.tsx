import type { Id } from "@/convex/_generated/dataModel";

import type {
  SchedulingDateRange,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";

import { PatientFocusedView } from "./patient-focused-view";
import { SmartphoneDevice } from "./smartphone-device";

interface PatientBookingFlowProps {
  dateRange: SchedulingDateRange;
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  simulatedContext: SchedulingSimulatedContext;
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

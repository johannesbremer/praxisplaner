import type { Id } from "@/convex/_generated/dataModel";

import type {
  SchedulingDateRange,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";

import { PatientView } from "./patient-view";
import { SmartphoneDevice } from "./smartphone-device";

interface PatientBookingFlowProps {
  dateRange: SchedulingDateRange;
  onLocationChange?: (locationId: Id<"locations">) => void;
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  simulatedContext: SchedulingSimulatedContext;
}

export function PatientBookingFlow({
  dateRange,
  onLocationChange,
  onSlotClick,
  onUpdateSimulatedContext,
  practiceId,
  ruleSetId,
  simulatedContext,
}: PatientBookingFlowProps) {
  return (
    <div className="flex justify-center">
      <SmartphoneDevice>
        <PatientView
          dateRange={dateRange}
          {...(onLocationChange && { onLocationChange })}
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

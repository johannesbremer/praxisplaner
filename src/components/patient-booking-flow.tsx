import type { Id } from "@/convex/_generated/dataModel";

import type {
  SchedulingDateRange,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";
import type { LocalAppointment } from "../utils/local-appointments";

import { PatientFocusedView } from "./patient-focused-view";
import { SmartphoneDevice } from "./smartphone-device";

interface PatientBookingFlowProps {
  dateRange: SchedulingDateRange;
  localAppointments?: LocalAppointment[];
  onCreateLocalAppointment?: (
    appointment: Omit<LocalAppointment, "id" | "isLocal">,
  ) => void;
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  practiceId: Id<"practices">;
  ruleSetId?: SchedulingRuleSetId;
  simulatedContext: SchedulingSimulatedContext;
}

export function PatientBookingFlow({
  dateRange,
  localAppointments = [],
  onCreateLocalAppointment,
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
          localAppointments={localAppointments}
          {...(onCreateLocalAppointment && { onCreateLocalAppointment })}
          practiceId={practiceId}
          {...(ruleSetId && { ruleSetId })}
          simulatedContext={simulatedContext}
        />
      </SmartphoneDevice>
    </div>
  );
}

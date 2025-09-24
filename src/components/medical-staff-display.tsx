import type { Id } from "@/convex/_generated/dataModel";

import type {
  SchedulingDateRange,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";
import type { LocalAppointment } from "../utils/local-appointments";

import { MedicalStaffView } from "./medical-staff-view";
import { XDRDevice } from "./xdr-device";

interface MedicalStaffDisplayProps {
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

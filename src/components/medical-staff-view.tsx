import type { Id } from "@/convex/_generated/dataModel";

import type {
  SchedulingDateRange,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";
import type { LocalAppointment } from "../utils/local-appointments";

import { PraxisCalendar } from "./praxis-calendar";

interface MedicalStaffViewProps {
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

export function MedicalStaffView({
  dateRange,
  localAppointments = [],
  onCreateLocalAppointment,
  onSlotClick,
  onUpdateSimulatedContext,
  practiceId,
  ruleSetId,
  simulatedContext,
}: MedicalStaffViewProps) {
  // Extract the simulation date from dateRange
  const simulationDate = new Date(dateRange.start);

  // Show the Terminkalender (appointment calendar) for medical staff
  return (
    <div className="h-full w-full overflow-auto p-6 space-y-6">
      <PraxisCalendar
        localAppointments={localAppointments}
        {...(onCreateLocalAppointment && { onCreateLocalAppointment })}
        {...(onSlotClick && { onSlotClick })}
        practiceId={practiceId}
        {...(ruleSetId && { ruleSetId })}
        simulatedContext={simulatedContext}
        {...(onUpdateSimulatedContext && { onUpdateSimulatedContext })}
        simulationDate={simulationDate}
      />
    </div>
  );
}

import type { Id } from "@/convex/_generated/dataModel";

import { SidebarProvider } from "@/components/ui/sidebar";

import type {
  SchedulingDateRange,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";

import { PraxisCalendar } from "./praxis-calendar";

interface MedicalStaffViewProps {
  dateRange: SchedulingDateRange;
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  practiceId: Id<"practices">;
  ruleSetId?: SchedulingRuleSetId;
  simulatedContext: SchedulingSimulatedContext;
}

export function MedicalStaffView({
  dateRange,
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
    <SidebarProvider>
      <div className="flex h-full w-full">
        <PraxisCalendar
          {...(onSlotClick && { onSlotClick })}
          practiceId={practiceId}
          {...(ruleSetId && { ruleSetId })}
          simulatedContext={simulatedContext}
          {...(onUpdateSimulatedContext && { onUpdateSimulatedContext })}
          simulationDate={simulationDate}
        />
      </div>
    </SidebarProvider>
  );
}

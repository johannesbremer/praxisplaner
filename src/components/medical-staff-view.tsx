import { Temporal } from "temporal-polyfill";

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
  // Extract the simulation date from dateRange - convert from ISO string to Temporal.PlainDate
  // Use includes check to safely handle strings with or without 'T'
  const dateString = dateRange.start.includes("T")
    ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      dateRange.start.split("T")[0]!
    : dateRange.start;
  const simulationDate = Temporal.PlainDate.from(dateString);

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

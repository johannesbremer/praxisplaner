import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import { SidebarProvider } from "@/components/ui/sidebar";

import type {
  PatientInfo,
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";

import { PraxisCalendar } from "./praxis-calendar";

interface MedicalStaffViewProps {
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  patient?: PatientInfo;
  practiceId: Id<"practices">;
  ruleSetId?: SchedulingRuleSetId;
  simulatedContext: SchedulingSimulatedContext;
  simulationDate: Temporal.PlainDate;
}

export function MedicalStaffView({
  onSlotClick,
  onUpdateSimulatedContext,
  patient,
  practiceId,
  ruleSetId,
  simulatedContext,
  simulationDate,
}: MedicalStaffViewProps) {
  // Show the Terminkalender (appointment calendar) for medical staff
  return (
    <SidebarProvider>
      <div className="flex h-full w-full">
        <PraxisCalendar
          onSlotClick={onSlotClick}
          onUpdateSimulatedContext={onUpdateSimulatedContext}
          patient={patient}
          practiceId={practiceId}
          ruleSetId={ruleSetId}
          simulatedContext={simulatedContext}
          simulationDate={simulationDate}
        />
      </div>
    </SidebarProvider>
  );
}

import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import type {
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";
import type { PatientInfo } from "../types";

import { MedicalStaffView } from "./medical-staff-view";
import { XDRDevice } from "./xdr-device";

interface MedicalStaffDisplayProps {
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  patient?: PatientInfo;
  practiceId: Id<"practices">;
  ruleSetId?: SchedulingRuleSetId;
  simulatedContext: SchedulingSimulatedContext;
  simulationDate: Temporal.PlainDate;
}

export function MedicalStaffDisplay({
  onSlotClick,
  onUpdateSimulatedContext,
  patient,
  practiceId,
  ruleSetId,
  simulatedContext,
  simulationDate,
}: MedicalStaffDisplayProps) {
  return (
    <div className="w-full px-6">
      <XDRDevice>
        <MedicalStaffView
          {...(onSlotClick && { onSlotClick })}
          {...(onUpdateSimulatedContext && { onUpdateSimulatedContext })}
          {...(patient && { patient })}
          practiceId={practiceId}
          {...(ruleSetId && { ruleSetId })}
          simulatedContext={simulatedContext}
          simulationDate={simulationDate}
        />
      </XDRDevice>
    </div>
  );
}

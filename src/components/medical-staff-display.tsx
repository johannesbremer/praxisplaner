import { Temporal } from "temporal-polyfill";

import type { Id } from "@/convex/_generated/dataModel";

import type {
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";
import type { PatientInfo } from "../types";

import { MedicalStaffView } from "./medical-staff-view";
import { ProDisplayXDRDevice } from "./xdr-device";

interface MedicalStaffDisplayProps {
  canManageCalendarPlanning?: boolean | undefined;
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  onVisibleColumnNamesChange?:
    | ((visibleColumnNames?: readonly string[]) => void)
    | undefined;
  patient?: PatientInfo;
  practiceId: Id<"practices">;
  ruleSetId: SchedulingRuleSetId;
  simulatedContext: SchedulingSimulatedContext;
  simulationDate: Temporal.PlainDate;
  visibleColumnNames?: readonly string[] | undefined;
}

export function MedicalStaffDisplay({
  canManageCalendarPlanning,
  onSlotClick,
  onUpdateSimulatedContext,
  onVisibleColumnNamesChange,
  patient,
  practiceId,
  ruleSetId,
  simulatedContext,
  simulationDate,
  visibleColumnNames,
}: MedicalStaffDisplayProps) {
  return (
    <div className="w-full px-6">
      <ProDisplayXDRDevice>
        <MedicalStaffView
          canManageCalendarPlanning={canManageCalendarPlanning}
          onVisibleColumnNamesChange={onVisibleColumnNamesChange}
          {...(onSlotClick && { onSlotClick })}
          {...(onUpdateSimulatedContext && { onUpdateSimulatedContext })}
          {...(patient && { patient })}
          practiceId={practiceId}
          ruleSetId={ruleSetId}
          simulatedContext={simulatedContext}
          simulationDate={simulationDate}
          visibleColumnNames={visibleColumnNames}
        />
      </ProDisplayXDRDevice>
    </div>
  );
}

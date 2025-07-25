import type { Id } from "@/convex/_generated/dataModel";

import { PraxisCalendar } from "./praxis-calendar";

interface MedicalStaffViewProps {
  dateRange: { end: string; start: string };
  onSlotClick?: (slot: {
    blockedByRuleId?: Id<"rules"> | undefined;
    duration: number;
    locationId?: Id<"locations"> | undefined;
    practitionerId: Id<"practitioners">;
    practitionerName: string;
    startTime: string;
    status: "AVAILABLE" | "BLOCKED";
  }) => void;
  onUpdateSimulatedContext?: (context: {
    appointmentType: string;
    patient: { isNew: boolean };
  }) => void;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets"> | undefined;
  simulatedContext: {
    appointmentType: string;
    patient: { isNew: boolean };
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MedicalStaffView(_props: MedicalStaffViewProps) {
  // Show the Terminkalender (appointment calendar) for medical staff
  return (
    <div className="h-full w-full overflow-auto p-6">
      <PraxisCalendar />
    </div>
  );
}

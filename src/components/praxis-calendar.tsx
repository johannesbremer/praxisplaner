import { Temporal } from "temporal-polyfill";

import type { Id } from "../../convex/_generated/dataModel";
import type {
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";
import type { PatientInfo } from "../types";

import { NewCalendar } from "./new-calendar";

interface PraxisCalendarProps {
  // Notify parent when the current date changes
  locationName?: string | undefined;
  onDateChange?: ((date: Temporal.PlainDate) => void) | undefined;
  onLocationResolved?:
    | ((locationId: Id<"locations">, locationName: string) => void)
    | undefined;
  onSlotClick?: ((slot: SchedulingSlot) => void) | undefined;
  onUpdateSimulatedContext?:
    | ((context: SchedulingSimulatedContext) => void)
    | undefined;
  patient?: PatientInfo | undefined;
  practiceId?: Id<"practices"> | undefined;
  ruleSetId?: SchedulingRuleSetId | undefined;
  selectedLocationId?: Id<"locations"> | undefined;
  showGdtAlert?: boolean | undefined;
  simulatedContext?: SchedulingSimulatedContext | undefined;
  simulationDate?: Temporal.PlainDate | undefined;
}

export function PraxisCalendar(props: PraxisCalendarProps) {
  // Simply pass through all props to the NewCalendar component
  return <NewCalendar {...props} />;
}

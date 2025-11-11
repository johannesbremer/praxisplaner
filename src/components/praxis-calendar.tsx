import { Temporal } from "temporal-polyfill";

import type { Id } from "../../convex/_generated/dataModel";
import type {
  SchedulingRuleSetId,
  SchedulingSimulatedContext,
  SchedulingSlot,
} from "../types";

import { NewCalendar } from "./new-calendar";

interface PraxisCalendarProps {
  // Notify parent when the current date changes
  locationSlug?: string | undefined;
  onDateChange?: (date: Temporal.PlainDate) => void;
  onLocationResolved?: (
    locationId: Id<"locations">,
    locationName: string,
  ) => void;
  onSlotClick?: (slot: SchedulingSlot) => void;
  onUpdateSimulatedContext?: (context: SchedulingSimulatedContext) => void;
  practiceId?: Id<"practices">;
  ruleSetId?: SchedulingRuleSetId;
  selectedLocationId?: Id<"locations"> | undefined;
  showGdtAlert?: boolean;
  simulatedContext?: SchedulingSimulatedContext;
  simulationDate?: Temporal.PlainDate;
}

export function PraxisCalendar(props: PraxisCalendarProps) {
  // Simply pass through all props to the NewCalendar component
  return <NewCalendar {...props} />;
}

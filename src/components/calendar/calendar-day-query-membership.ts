import type { Id } from "../../../convex/_generated/dataModel";
import type { CalendarDayQueryArgs } from "./calendar-query-args";

import { safeParseISOToZoned } from "../../utils/time-calculations";

interface CalendarDayEntity {
  isSimulation?: boolean;
  locationId: Id<"locations">;
  practiceId: Id<"practices">;
  start: string;
}

export function matchesCalendarDayQueryEntity(
  args: CalendarDayQueryArgs,
  entity: CalendarDayEntity,
): boolean {
  if (entity.practiceId !== args.practiceId) {
    return false;
  }

  if (args.locationId !== undefined && entity.locationId !== args.locationId) {
    return false;
  }

  if (args.scope === "real" && entity.isSimulation === true) {
    return false;
  }

  const candidateStart = safeParseISOToZoned(entity.start);
  const dayStart = safeParseISOToZoned(args.dayStart);
  const dayEnd = safeParseISOToZoned(args.dayEnd);
  if (!candidateStart || !dayStart || !dayEnd) {
    return false;
  }

  const candidateEpoch = candidateStart.epochMilliseconds;
  return (
    candidateEpoch >= dayStart.epochMilliseconds &&
    candidateEpoch < dayEnd.epochMilliseconds
  );
}

export function shouldCollapseOptimisticReplacementInDayQuery(args: {
  isSimulation?: boolean;
  scope: CalendarDayQueryArgs["scope"];
}): boolean {
  return args.scope === "simulation" && args.isSimulation === true;
}

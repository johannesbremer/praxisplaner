import type { Infer } from "convex/values";

import { Temporal } from "temporal-polyfill";

import type {
  DeDateString,
  InstantString,
  IsoDateString,
  TimeString,
} from "../lib/typed-regex";

import {
  DE_DATE_REGEX,
  ISO_DATE_REGEX,
  TIME_OF_DAY_REGEX,
} from "../lib/typed-regex.js";
import {
  baseScheduleCreatePayloadValidator,
  baseSchedulePayloadValidator,
} from "./entities.validators";
import {
  dataSharingContactInputValidator,
  personalDataValidator,
  selectedSlotValidator,
} from "./schema";
import {
  availableSlotsResultValidator,
  dateRangeValidator,
  simulatedContextValidator,
} from "./validators";

export interface AvailableSlotsResult {
  log: string[];
  slots: SchedulingResultSlot[];
}

export type BaseScheduleCreatePayload = Omit<
  Infer<typeof baseScheduleCreatePayloadValidator>,
  "breakTimes" | "endTime" | "startTime"
> & {
  breakTimes?: TypedBreakTime[];
  endTime: TimeString;
  startTime: TimeString;
};

export type BaseSchedulePayload = Omit<
  Infer<typeof baseSchedulePayloadValidator>,
  "breakTimes" | "endTime" | "startTime"
> & {
  breakTimes?: TypedBreakTime[];
  endTime: TimeString;
  startTime: TimeString;
};

export type DataSharingContactInput = Omit<
  Infer<typeof dataSharingContactInputValidator>,
  "dateOfBirth"
> & {
  dateOfBirth: IsoDateString;
};

export interface DateRangeInput {
  end: InstantString;
  start: InstantString;
}

export type PersonalDataInput = Omit<
  Infer<typeof personalDataValidator>,
  "dateOfBirth"
> & {
  dateOfBirth: IsoDateString;
};

export type SchedulingResultSlot = Omit<
  Infer<typeof availableSlotsResultValidator>["slots"][number],
  "startTime"
> & {
  startTime: ZonedDateTimeString;
};

export type SelectedSlotInput = Omit<
  Infer<typeof selectedSlotValidator>,
  "startTime"
> & {
  startTime: ZonedDateTimeString;
};

export type SimulatedContextInput = Omit<
  Infer<typeof simulatedContextValidator>,
  "patient" | "requestedAt"
> & {
  patient: Omit<
    Infer<typeof simulatedContextValidator>["patient"],
    "dateOfBirth"
  > & {
    dateOfBirth?: IsoDateString;
  };
  requestedAt?: InstantString;
};

export interface TypedBreakTime {
  end: TimeString;
  start: TimeString;
}

export type ZonedDateTimeString = `${IsoDateString}T${string}`;

export function asAvailableSlotsResult(
  value: Infer<typeof availableSlotsResultValidator>,
): AvailableSlotsResult {
  return {
    ...value,
    slots: value.slots.map((slot) => asSchedulingResultSlot(slot)),
  };
}

export function asBaseScheduleCreatePayload(
  value: Infer<typeof baseScheduleCreatePayloadValidator>,
): BaseScheduleCreatePayload {
  const { breakTimes, endTime, startTime, ...rest } = value;
  return {
    ...rest,
    ...(breakTimes !== undefined && {
      breakTimes: asTypedBreakTimes(breakTimes),
    }),
    endTime: asTimeString(endTime),
    startTime: asTimeString(startTime),
  };
}

export function asBaseSchedulePayload(
  value: Infer<typeof baseSchedulePayloadValidator>,
): BaseSchedulePayload {
  const { breakTimes, endTime, startTime, ...rest } = value;
  return {
    ...rest,
    ...(breakTimes !== undefined && {
      breakTimes: asTypedBreakTimes(breakTimes),
    }),
    endTime: asTimeString(endTime),
    startTime: asTimeString(startTime),
  };
}

export function asDataSharingContactInput(
  value: Infer<typeof dataSharingContactInputValidator>,
): DataSharingContactInput {
  return {
    ...value,
    dateOfBirth: asIsoDateString(value.dateOfBirth),
  };
}

export function asDateRangeInput(
  value: Infer<typeof dateRangeValidator>,
): DateRangeInput {
  return {
    end: asInstantString(value.end),
    start: asInstantString(value.start),
  };
}

export function asDeDateString(value: string): DeDateString {
  if (!DE_DATE_REGEX.test(value)) {
    throw new Error(`Expected DD.MM.YYYY date string, got "${value}".`);
  }

  return value;
}

export function asInstantString(value: string): InstantString {
  try {
    return Temporal.Instant.from(value).toString() as InstantString;
  } catch {
    throw new Error(`Expected ISO instant string, got "${value}".`);
  }
}

export function asIsoDateString(value: string): IsoDateString {
  if (!ISO_DATE_REGEX.test(value)) {
    throw new Error(`Expected YYYY-MM-DD date string, got "${value}".`);
  }

  return value;
}

export function asPersonalDataInput(
  value: Infer<typeof personalDataValidator>,
): PersonalDataInput {
  return {
    ...value,
    dateOfBirth: asIsoDateString(value.dateOfBirth),
  };
}

export function asSchedulingResultSlot(
  value: Infer<typeof availableSlotsResultValidator>["slots"][number],
): SchedulingResultSlot {
  return {
    ...value,
    startTime: asZonedDateTimeString(value.startTime),
  };
}

export function asSelectedSlotInput(
  value: Infer<typeof selectedSlotValidator>,
): SelectedSlotInput {
  return {
    ...value,
    startTime: asZonedDateTimeString(value.startTime),
  };
}

export function asSimulatedContextInput(
  value: Infer<typeof simulatedContextValidator>,
): SimulatedContextInput {
  const { patient, requestedAt, ...rest } = value;
  const { dateOfBirth, ...patientRest } = patient;
  return {
    ...rest,
    patient: {
      ...patientRest,
      ...(dateOfBirth !== undefined && {
        dateOfBirth: asIsoDateString(dateOfBirth),
      }),
    },
    ...(requestedAt !== undefined && {
      requestedAt: asInstantString(requestedAt),
    }),
  };
}

export function asTimeString(value: string): TimeString {
  if (!TIME_OF_DAY_REGEX.test(value)) {
    throw new Error(`Expected HH:mm time string, got "${value}".`);
  }

  return value;
}

export function asZonedDateTimeString(value: string): ZonedDateTimeString {
  try {
    const zonedDateTime = Temporal.ZonedDateTime.from(value);
    const normalized = zonedDateTime.toString();
    return normalized as ZonedDateTimeString;
  } catch {
    throw new Error(`Expected ISO zoned datetime string, got "${value}".`);
  }
}

function asTypedBreakTime(value: {
  end: string;
  start: string;
}): TypedBreakTime {
  return {
    end: asTimeString(value.end),
    start: asTimeString(value.start),
  };
}

function asTypedBreakTimes(
  value: { end: string; start: string }[],
): TypedBreakTime[] {
  return value.map((breakTime) => asTypedBreakTime(breakTime));
}

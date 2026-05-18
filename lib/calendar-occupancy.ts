export type AppointmentOccupancyScope<PractitionerKey extends string = string> =
  Exclude<CalendarOccupancyScope<PractitionerKey>, LocationWideOccupancyScope>;

export type BlockedSlotOccupancyScope<PractitionerKey extends string = string> =
  Exclude<CalendarOccupancyScope<PractitionerKey>, ResourceOccupancyScope>;

export type CalendarColumnInput<PractitionerKey extends string = string> =
  | CalendarColumnScope<PractitionerKey>
  | CalendarResourceColumn
  | PractitionerKey;

export type CalendarColumnScope<PractitionerKey extends string = string> =
  AppointmentOccupancyScope<PractitionerKey>;

export type CalendarOccupancyScope<PractitionerKey extends string = string> =
  | LocationWideOccupancyScope
  | PractitionerOccupancyScope<PractitionerKey>
  | ResourceOccupancyScope;

export interface CalendarPlacement<
  LocationKey extends string = string,
  TScope extends CalendarOccupancyScope = CalendarOccupancyScope,
> {
  locationLineageKey: LocationKey;
  occupancyScope: TScope;
}

export type CalendarResourceColumn = "ekg" | "labor";

export interface LocationWideOccupancyScope {
  kind: "location-wide";
}

export interface PractitionerOccupancyScope<
  PractitionerKey extends string = string,
> {
  kind: "practitioner";
  practitionerLineageKey: PractitionerKey;
}

export interface ResourceOccupancyScope {
  calendarResourceColumn: CalendarResourceColumn;
  kind: "resource";
}

export function appointmentOccupancyFromCalendarColumn<
  PractitionerKey extends string,
>(
  column: CalendarColumnScope<PractitionerKey>,
): AppointmentOccupancyScope<PractitionerKey> {
  return column;
}

export function blockedSlotOccupancyScopeFromPractitioner<
  PractitionerKey extends string,
>(
  practitionerLineageKey: PractitionerKey | undefined,
): BlockedSlotOccupancyScope<PractitionerKey> {
  return practitionerLineageKey === undefined
    ? { kind: "location-wide" }
    : { kind: "practitioner", practitionerLineageKey };
}

export function calendarColumnScopeFromAppointmentOccupancy<
  PractitionerKey extends string,
>(
  scope: AppointmentOccupancyScope<PractitionerKey>,
): CalendarColumnScope<PractitionerKey> {
  return scope;
}

export function calendarColumnScopeFromOccupancy<
  PractitionerKey extends string,
>(
  scope: CalendarOccupancyScope<PractitionerKey>,
): CalendarColumnScope<PractitionerKey> | null {
  return isLocationWideOccupancyScope(scope) ? null : scope;
}

export function calendarColumnScopeFromPractitioner<
  PractitionerKey extends string,
>(
  practitionerLineageKey: PractitionerKey,
): PractitionerOccupancyScope<PractitionerKey> {
  return { kind: "practitioner", practitionerLineageKey };
}

export function calendarColumnScopeFromResourceColumn(
  calendarResourceColumn: CalendarResourceColumn,
): ResourceOccupancyScope {
  return { calendarResourceColumn, kind: "resource" };
}

export function calendarColumnScopeKey<PractitionerKey extends string>(
  scope: CalendarColumnInput<PractitionerKey>,
): string {
  return calendarOccupancyScopeKey(normalizeCalendarColumnScope(scope));
}

export function calendarOccupancyScopeKey<PractitionerKey extends string>(
  scope: CalendarOccupancyScope<PractitionerKey>,
): string {
  switch (scope.kind) {
    case "location-wide": {
      return "location-wide";
    }
    case "practitioner": {
      return `practitioner:${scope.practitionerLineageKey}`;
    }
    case "resource": {
      return `resource:${scope.calendarResourceColumn}`;
    }
  }
}

export function calendarOccupancyScopesConflict<PractitionerKey extends string>(
  existing: CalendarOccupancyScope<PractitionerKey>,
  candidate: CalendarOccupancyScope<PractitionerKey>,
): boolean {
  if (
    !isLocationWideOccupancyScope(existing) &&
    !isLocationWideOccupancyScope(candidate) &&
    !sameCalendarOccupancyScope(existing, candidate)
  ) {
    return false;
  }

  return true;
}

export function createCalendarPlacement<
  LocationKey extends string,
  TScope extends CalendarOccupancyScope,
>(args: {
  locationLineageKey: LocationKey;
  occupancyScope: TScope;
}): CalendarPlacement<LocationKey, TScope> {
  return args;
}

export function getCalendarResourceColumnFromColumn<
  PractitionerKey extends string,
>(
  column: CalendarColumnInput<PractitionerKey>,
): CalendarResourceColumn | undefined {
  const normalizedColumn = normalizeCalendarColumnScope(column);
  return normalizedColumn.kind === "resource"
    ? normalizedColumn.calendarResourceColumn
    : undefined;
}

export function getCalendarResourceColumnFromOccupancy<
  PractitionerKey extends string,
>(
  scope: CalendarOccupancyScope<PractitionerKey>,
): CalendarResourceColumn | undefined {
  return scope.kind === "resource" ? scope.calendarResourceColumn : undefined;
}

export function getPractitionerLineageKeyFromColumn<
  PractitionerKey extends string,
>(column: CalendarColumnInput<PractitionerKey>): PractitionerKey | undefined {
  const normalizedColumn = normalizeCalendarColumnScope(column);
  return normalizedColumn.kind === "practitioner"
    ? normalizedColumn.practitionerLineageKey
    : undefined;
}

export function getPractitionerLineageKeyFromOccupancy<
  PractitionerKey extends string,
>(scope: CalendarOccupancyScope<PractitionerKey>): PractitionerKey | undefined {
  return scope.kind === "practitioner"
    ? scope.practitionerLineageKey
    : undefined;
}

export function isCalendarResourceColumn(
  value: string,
): value is CalendarResourceColumn {
  return value === "ekg" || value === "labor";
}

export function isLocationWideOccupancyScope(
  scope: CalendarOccupancyScope,
): scope is LocationWideOccupancyScope {
  return scope.kind === "location-wide";
}

export function isPractitionerOccupancyScope<PractitionerKey extends string>(
  scope: CalendarOccupancyScope<PractitionerKey>,
): scope is PractitionerOccupancyScope<PractitionerKey> {
  return scope.kind === "practitioner";
}

export function isResourceOccupancyScope<PractitionerKey extends string>(
  scope: CalendarOccupancyScope<PractitionerKey>,
): scope is ResourceOccupancyScope {
  return scope.kind === "resource";
}

export function normalizeCalendarColumnScope<PractitionerKey extends string>(
  column: CalendarColumnInput<PractitionerKey>,
): CalendarColumnScope<PractitionerKey> {
  if (typeof column !== "string") {
    return column;
  }

  if (isCalendarResourceColumn(column)) {
    return { calendarResourceColumn: column, kind: "resource" };
  }

  return { kind: "practitioner", practitionerLineageKey: column };
}

export function sameCalendarColumnScope<PractitionerKey extends string>(
  left: CalendarColumnInput<PractitionerKey>,
  right: CalendarColumnInput<PractitionerKey>,
): boolean {
  return sameCalendarOccupancyScope(
    normalizeCalendarColumnScope(left),
    normalizeCalendarColumnScope(right),
  );
}

export function sameCalendarOccupancyScope<PractitionerKey extends string>(
  left: CalendarOccupancyScope<PractitionerKey>,
  right: CalendarOccupancyScope<PractitionerKey>,
): boolean {
  return calendarOccupancyScopeKey(left) === calendarOccupancyScopeKey(right);
}

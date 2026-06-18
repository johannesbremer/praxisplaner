export type AppointmentTypeDefaultOccupancy =
  | undefined
  | { calendarResourceColumn: "ekg" | "labor"; kind: "resourceColumn" }
  | { kind: "selectedPractitioner" };

export function sameAppointmentTypeDefaultOccupancy(
  left: AppointmentTypeDefaultOccupancy,
  right: AppointmentTypeDefaultOccupancy,
) {
  const normalizedLeft = normalizeAppointmentTypeDefaultOccupancy(left);
  const normalizedRight = normalizeAppointmentTypeDefaultOccupancy(right);
  if (normalizedLeft.kind !== normalizedRight.kind) {
    return false;
  }
  if (normalizedLeft.kind === "selectedPractitioner") {
    return true;
  }
  return (
    normalizedRight.kind === "resourceColumn" &&
    normalizedLeft.calendarResourceColumn ===
      normalizedRight.calendarResourceColumn
  );
}

function normalizeAppointmentTypeDefaultOccupancy(
  value: AppointmentTypeDefaultOccupancy,
): Exclude<AppointmentTypeDefaultOccupancy, undefined> {
  return value ?? { kind: "selectedPractitioner" };
}

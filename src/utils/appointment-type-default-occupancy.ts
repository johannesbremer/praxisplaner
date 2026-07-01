export type AppointmentTypeDefaultOccupancy =
  | { calendarResourceColumn: "ekg" | "labor"; kind: "resourceColumn" }
  | { kind: "selectedPractitioner" };

export function sameAppointmentTypeDefaultOccupancy(
  left: AppointmentTypeDefaultOccupancy,
  right: AppointmentTypeDefaultOccupancy,
) {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "selectedPractitioner") {
    return true;
  }
  return (
    right.kind === "resourceColumn" &&
    left.calendarResourceColumn === right.calendarResourceColumn
  );
}

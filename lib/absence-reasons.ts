export const ABSENCE_REASON_OPTIONS = [
  { label: "Urlaub", short: "U", value: "vacation" },
  { label: "Krank", short: "K", value: "sick" },
  { label: "Überstunden", short: "Ü", value: "overtime" },
  { label: "Fortbildung", short: "F", value: "training" },
  { label: "Kinderkrank", short: "KK", value: "child-sick" },
  { label: "Sonstiges", short: "S", value: "other" },
  { label: "Geburtstag", short: "G", value: "birthday" },
] as const;

export type AbsenceReason = (typeof ABSENCE_REASON_OPTIONS)[number]["value"];

export const ABSENCE_REASON_META: Record<
  AbsenceReason,
  { label: string; short: string }
> = {
  birthday: { label: "Geburtstag", short: "G" },
  "child-sick": { label: "Kinderkrank", short: "KK" },
  other: { label: "Sonstiges", short: "S" },
  overtime: { label: "Überstunden", short: "Ü" },
  sick: { label: "Krank", short: "K" },
  training: { label: "Fortbildung", short: "F" },
  vacation: { label: "Urlaub", short: "U" },
};

export function formatAbsenceReason(reason: AbsenceReason): string {
  return ABSENCE_REASON_META[reason].label;
}

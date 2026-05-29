const canonicalPractitionerNameByImportedName = new Map<string, string>([
  ["Doc 1 Iburg", "Doc 1"],
  ["Dr. K. Bremer Dissen", "Dr. K. Bremer"],
  ["Dr. K. Bremer Iburg", "Dr. K. Bremer"],
  ["Dr. V. MzH Dissen", "Dr. V. MzH"],
  ["Dr. V. MzH Iburg", "Dr. V. MzH"],
  ["IburgTrottenberg", "Miriam Trottenberg"],
]);

export function normalizeImportedPractitionerName(
  practitionerName: string,
): string {
  return (
    canonicalPractitionerNameByImportedName.get(practitionerName) ??
    practitionerName
  );
}

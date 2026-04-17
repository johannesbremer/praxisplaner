interface PatientSearchTextFields {
  firstName?: string | undefined;
  lastName?: string | undefined;
  name?: string | undefined;
  patientId?: number | undefined;
  phoneNumber?: string | undefined;
}

export function buildPatientSearchText(
  fields: PatientSearchTextFields,
): string {
  const firstAndLastName = [fields.firstName, fields.lastName]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" ");

  return [
    fields.name,
    firstAndLastName,
    fields.firstName,
    fields.lastName,
    fields.patientId?.toString(),
    fields.phoneNumber,
  ]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" ")
    .trim();
}

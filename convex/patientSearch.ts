interface PatientSearchNameFields {
  firstName?: string | undefined;
  lastName?: string | undefined;
  name?: string | undefined;
}

export function buildPatientSearchFirstName(
  fields: PatientSearchNameFields,
): string {
  if (fields.name !== undefined && fields.name.trim().length > 0) {
    return fields.name.trim();
  }

  return fields.firstName?.trim() ?? "";
}

export function buildPatientSearchLastName(
  fields: PatientSearchNameFields,
): string {
  if (fields.name !== undefined && fields.name.trim().length > 0) {
    return fields.name.trim();
  }

  return fields.lastName?.trim() ?? "";
}

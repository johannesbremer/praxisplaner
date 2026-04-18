interface PatientSearchableFields extends PatientSearchNameFields {
  patientId?: number | undefined;
}

interface PatientSearchNameFields {
  firstName?: string | undefined;
  lastName?: string | undefined;
  name?: string | undefined;
}

export function buildPatientSearchFirstName(
  fields: PatientSearchNameFields,
): string {
  return compactSearchParts([
    fields.name,
    fields.firstName && fields.lastName
      ? `${fields.firstName} ${fields.lastName}`
      : (fields.firstName ?? fields.lastName),
  ]).join(" ");
}

export function buildPatientSearchLastName(
  fields: PatientSearchNameFields,
): string {
  return compactSearchParts([
    fields.name,
    fields.lastName && fields.firstName
      ? `${fields.lastName} ${fields.firstName}`
      : (fields.lastName ?? fields.firstName),
  ]).join(" ");
}

export function normalizePatientSearchText(value: string): string {
  return value.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase();
}

export function patientMatchesSearchTerm(
  fields: PatientSearchableFields,
  searchTerm: string,
): boolean {
  const searchTokens = normalizePatientSearchText(searchTerm)
    .split(" ")
    .filter((token) => token.length > 0);

  if (searchTokens.length === 0) {
    return true;
  }

  const candidates = getPatientSearchCandidates(fields).map((candidate) =>
    normalizePatientSearchText(candidate),
  );

  if (candidates.length === 0) {
    return false;
  }

  return searchTokens.every((token) =>
    candidates.some((candidate) => candidate.includes(token)),
  );
}

function compactSearchParts(parts: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const compacted: string[] = [];

  for (const part of parts) {
    const compactPart = part?.trim().replaceAll(/\s+/gu, " ");
    if (!compactPart) {
      continue;
    }

    const value = normalizePatientSearchText(compactPart);
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    compacted.push(compactPart);
  }

  return compacted;
}

function getPatientSearchCandidates(fields: PatientSearchableFields): string[] {
  const compactName = fields.name?.trim();
  const compactFirstName = fields.firstName?.trim();
  const compactLastName = fields.lastName?.trim();
  const fullName =
    compactFirstName && compactLastName
      ? `${compactFirstName} ${compactLastName}`
      : (compactFirstName ?? compactLastName);

  return compactSearchParts([
    compactName,
    fullName,
    compactLastName && compactFirstName
      ? `${compactLastName} ${compactFirstName}`
      : undefined,
    compactFirstName,
    compactLastName,
    fields.patientId?.toString(),
  ]);
}

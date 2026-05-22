import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Temporal } from "temporal-polyfill";

import { importedPractitionerNameFromLegacyDoc } from "./legacy-practitioner-mapping.js";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const legacyDbPath = join(workspaceRoot, ".cache/migration/source/data.db");
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const matchesPath = join(
  reportRoot,
  "legacy-appointment-correlation-matches.csv",
);
const unmatchedPath = join(
  reportRoot,
  "legacy-appointment-correlation-unmatched.csv",
);

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        quoted = false;
        continue;
      }
      field += char;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  if (!headers) {
    return [];
  }

  return records
    .filter((record) => record.length === headers.length)
    .map((record) =>
      Object.fromEntries(
        headers.map((header, index) => [header, record[index] ?? ""]),
      ),
    );
}

function readSqliteJson(query) {
  const output = execFileSync("sqlite3", ["-json", legacyDbPath, query], {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  return output.length === 0 ? [] : JSON.parse(output);
}

function writeJsonl(path, rows) {
  writeFileSync(
    path,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length > 0 ? "\n" : ""),
  );
}

function normalizeDate(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length === 0) {
    return "1900-01-01";
  }
  return trimmed.slice(0, 10);
}

function normalizeGender(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();
  if (["f", "frau", "female", "w", "weiblich"].includes(normalized)) {
    return "female";
  }
  if (
    ["herr", "m", "male", "mann", "maennlich", "männlich"].includes(normalized)
  ) {
    return "male";
  }
  return "diverse";
}

function normalizeEmail(email, fallbackLocalPart, domain) {
  return typeof email === "string" && email.includes("@")
    ? email
    : `${fallbackLocalPart}@${domain}`;
}

function normalizeLocationName(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }
  if (/\b(?:bad\s+)?iburg|\bibu\b/u.test(normalized)) {
    return "Bad Iburg";
  }
  if (/\bdiss(?:en)?\b/u.test(normalized)) {
    return "Dissen a.T.W.";
  }
  return undefined;
}

function normalizeHzvStatus(value) {
  switch (
    String(value ?? "")
      .trim()
      .toLocaleLowerCase()
  ) {
    case "hat bereits":
      return "has-contract";
    case "interesse":
      return "interested";
    case "kein interesse":
      return "no-interest";
    default:
      return undefined;
  }
}

function normalizeInsuranceType(args) {
  const kasse = String(args.kasse ?? "")
    .trim()
    .toLocaleLowerCase();
  if (kasse === "gkv") {
    return "gkv";
  }
  if (kasse === "pkv") {
    return "pkv";
  }
  if (args.hasPkvRow || args.pvsConsent) {
    return "pkv";
  }
  return undefined;
}

function normalizePkvInsuranceType(value) {
  switch (
    String(value ?? "")
      .trim()
      .toLocaleLowerCase()
  ) {
    case "andere":
      return "other";
    case "kvb":
      return "kvb";
    case "postb":
      return "postb";
    default:
      return undefined;
  }
}

function normalizePkvTariff(value) {
  switch (
    String(value ?? "")
      .trim()
      .toLocaleLowerCase()
  ) {
    case "basis":
      return "basis";
    case "standard":
      return "standard";
    case "premium":
      return "premium";
    default:
      return undefined;
  }
}

function normalizeBeihilfeStatus(value) {
  switch (
    String(value ?? "")
      .trim()
      .toLocaleLowerCase()
  ) {
    case "ja":
      return "yes";
    case "nein":
      return "no";
    default:
      return undefined;
  }
}

function toStoredPvsDateTime(value) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/,
  );
  if (!match) {
    throw new Error(`Unsupported Praxistimer datetime: ${value}`);
  }
  return `${match[1]}T${match[2]}${match[3]}[Europe/Berlin]`;
}

function toStoredLegacyDateTime(value) {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO("Europe/Berlin")
    .toString();
}

function parseDate(value) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Unsupported date: ${value}`);
  }
  return new Date(timestamp);
}

function durationMinutes(start, end) {
  const minutes =
    (parseDate(end).getTime() - parseDate(start).getTime()) / 60_000;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
}

function trimToUndefined(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function personalDataFromFields(fields) {
  const firstName = trimToUndefined(fields.firstName);
  const lastName = trimToUndefined(fields.lastName);
  const dateOfBirth = trimToUndefined(normalizeDate(fields.dateOfBirth));

  if (!firstName || !lastName || !dateOfBirth) {
    return undefined;
  }

  return {
    ...(trimToUndefined(fields.city) ? { city: fields.city } : {}),
    dateOfBirth,
    ...(trimToUndefined(fields.email) ? { email: fields.email } : {}),
    firstName,
    ...(trimToUndefined(fields.gender) ? { gender: fields.gender } : {}),
    lastName,
    phoneNumber: String(fields.phoneNumber ?? "").trim(),
    ...(trimToUndefined(fields.postalCode)
      ? { postalCode: fields.postalCode }
      : {}),
    ...(trimToUndefined(fields.street) ? { street: fields.street } : {}),
    ...(trimToUndefined(fields.title) ? { title: fields.title } : {}),
  };
}

function personalDataFromLegacyUser(userId, args) {
  const personal = args.personalByUser.get(userId);
  const fallbackMatch = args.allowPvsFallback ? args.fallbackMatch : undefined;
  const fallbackFirstName = fallbackMatch?.patientFirstName;
  const fallbackLastName = fallbackMatch?.patientLastName;
  const fallbackBirthDate = fallbackMatch?.birthDate;

  return personalDataFromFields({
    city: personal?.ort ?? "",
    dateOfBirth: personal?.geburtstag ?? fallbackBirthDate ?? "",
    email: normalizeEmail(args.userEmail, userId, "legacy-users.invalid"),
    firstName: personal?.vorname ?? fallbackFirstName ?? "",
    gender: normalizeGender(personal?.geschlecht),
    lastName: personal?.name ?? fallbackLastName ?? "",
    phoneNumber: personal?.tel ?? "",
    postalCode: personal?.plz ?? "",
    street: personal?.strasse ?? "",
    title: personal?.dr ?? "",
  });
}

function hasLegacyRequiredIdentityFields(fields) {
  return (
    trimToUndefined(fields.gender) !== undefined &&
    trimToUndefined(fields.firstName) !== undefined &&
    trimToUndefined(fields.lastName) !== undefined &&
    trimToUndefined(fields.dateOfBirth) !== undefined &&
    trimToUndefined(fields.phoneNumber) !== undefined &&
    trimToUndefined(fields.street) !== undefined &&
    trimToUndefined(fields.postalCode) !== undefined &&
    trimToUndefined(fields.city) !== undefined
  );
}

function isLegacyPersonalDataComplete(userId, personalByUser) {
  const personal = personalByUser.get(userId);
  if (!personal) {
    return false;
  }

  return hasLegacyRequiredIdentityFields({
    city: personal.ort ?? "",
    dateOfBirth: personal.geburtstag ?? "",
    firstName: personal.vorname ?? "",
    gender: personal.geschlecht ?? "",
    lastName: personal.name ?? "",
    phoneNumber: personal.tel ?? "",
    postalCode: personal.plz ?? "",
    street: personal.strasse ?? "",
  });
}

function dataSharingContactsForUser(userId, dataSharingByUser) {
  return (dataSharingByUser.get(userId) ?? [])
    .map((contact) => ({
      city: contact.ort ?? "",
      dateOfBirth: normalizeDate(contact.geburtstag),
      firstName: contact.vorname ?? "",
      gender: normalizeGender(contact.geschlecht),
      lastName: contact.name ?? "",
      phoneNumber: contact.tel ?? "",
      postalCode: contact.plz ?? "",
      street: contact.str ?? "",
      ...(contact.dr ? { title: contact.dr } : {}),
    }))
    .filter(
      (contact) =>
        contact.firstName.length > 0 ||
        contact.lastName.length > 0 ||
        contact.phoneNumber.length > 0,
    );
}

function isLegacyDataSharingComplete(userId, dataSharingByUser) {
  const contacts = dataSharingByUser.get(userId) ?? [];
  if (contacts.length === 0) {
    return false;
  }

  return contacts.every((contact) =>
    hasLegacyRequiredIdentityFields({
      city: contact.ort ?? "",
      dateOfBirth: contact.geburtstag ?? "",
      firstName: contact.vorname ?? "",
      gender: contact.geschlecht ?? "",
      lastName: contact.name ?? "",
      phoneNumber: contact.tel ?? "",
      postalCode: contact.plz ?? "",
      street: contact.str ?? "",
    }),
  );
}

function medicalHistoryFromUser(userId, anamneseByUser, anamneseTextByUser) {
  const checkbox = anamneseByUser.get(userId);
  const text = anamneseTextByUser.get(userId);

  if (!checkbox && !text) {
    return undefined;
  }

  const allergyNotes = [
    trimToUndefined(text?.alltext),
    trimToUndefined(text?.unvtext),
  ]
    .filter(Boolean)
    .join("; ");
  const otherConditions = [
    checkbox?.bluthochdruck === 1 ? "Bluthochdruck" : undefined,
    checkbox?.brustenge === 1 ? "Brustenge" : undefined,
    checkbox?.durchblutung === 1 ? "Durchblutungsstörung" : undefined,
    checkbox?.blutfett === 1 ? "Fettstoffwechselstörung" : undefined,
    checkbox?.gicht === 1 ? "Gicht" : undefined,
    checkbox?.krebs === 1 ? "Krebserkrankung" : undefined,
    checkbox?.leber === 1 ? "Lebererkrankung" : undefined,
    checkbox?.niere === 1 ? "Nierenerkrankung" : undefined,
    checkbox?.schilddruese === 1 ? "Schilddrüsenerkrankung" : undefined,
    checkbox?.krampfadern === 1 ? "Krampfadern" : undefined,
    checkbox?.depression === 1 ? "Depression" : undefined,
    trimToUndefined(text?.betext),
    trimToUndefined(text?.optext),
  ]
    .filter(Boolean)
    .join("; ");

  return {
    ...(allergyNotes.length > 0 ? { allergiesDescription: allergyNotes } : {}),
    ...(trimToUndefined(text?.medtext)
      ? { currentMedications: text.medtext.trim() }
      : {}),
    hasAllergies: checkbox?.allergien === 1 || checkbox?.unvertraeglich === 1,
    hasDiabetes: checkbox?.diabetes === 1,
    hasHeartCondition:
      checkbox?.herz === 1 ||
      checkbox?.bluthochdruck === 1 ||
      checkbox?.brustenge === 1 ||
      checkbox?.durchblutung === 1,
    hasLungCondition: checkbox?.lunge === 1,
    ...(otherConditions.length > 0 ? { otherConditions } : {}),
  };
}

function isLegacyCheckboxAnamneseComplete(userId, anamneseByUser) {
  const checkbox = anamneseByUser.get(userId);
  if (!checkbox) {
    return false;
  }

  return (
    checkbox.diabetes === 1 ||
    checkbox.schilddruese === 1 ||
    checkbox.leber === 1 ||
    checkbox.niere === 1 ||
    checkbox.blutfett === 1 ||
    checkbox.gicht === 1 ||
    checkbox.bluthochdruck === 1 ||
    checkbox.lunge === 1 ||
    checkbox.herz === 1 ||
    checkbox.durchblutung === 1 ||
    checkbox.krampfadern === 1 ||
    checkbox.krebs === 1 ||
    checkbox.depression === 1 ||
    checkbox.rauchen === 1 ||
    trimToUndefined(checkbox.sonstiges) !== undefined ||
    checkbox.keins === 1
  );
}

function isLegacyTextAnamneseComplete(userId, anamneseTextByUser) {
  const text = anamneseTextByUser.get(userId);
  if (!text) {
    return false;
  }

  const selectedAny =
    text.medikamente === 1 ||
    text.unvertraeglich === 1 ||
    text.allergien === 1 ||
    text.operationen === 1 ||
    text.beschwerden === 1 ||
    text.keins === 1;
  if (!selectedAny) {
    return false;
  }

  if (text.medikamente === 1 && trimToUndefined(text.medtext) === undefined) {
    return false;
  }
  if (
    text.unvertraeglich === 1 &&
    trimToUndefined(text.unvtext) === undefined
  ) {
    return false;
  }
  if (text.allergien === 1 && trimToUndefined(text.alltext) === undefined) {
    return false;
  }
  if (text.operationen === 1 && trimToUndefined(text.optext) === undefined) {
    return false;
  }
  if (text.beschwerden === 1 && trimToUndefined(text.betext) === undefined) {
    return false;
  }

  return true;
}

function isLegacyMedicalHistoryComplete(
  userId,
  anamneseByUser,
  anamneseTextByUser,
) {
  return (
    isLegacyCheckboxAnamneseComplete(userId, anamneseByUser) &&
    isLegacyTextAnamneseComplete(userId, anamneseTextByUser)
  );
}

function normalizeImportedReasonDescription(value, sourceKind) {
  const trimmed = trimToUndefined(value);
  if (!trimmed) {
    return { reasonDescription: undefined, strippedPrefix: undefined };
  }

  if (sourceKind === "online") {
    const normalized = trimmed.replace(/^Online:\s*/u, "").trim();
    return {
      reasonDescription: normalized,
      strippedPrefix: normalized === trimmed ? undefined : "Online",
    };
  }
  if (sourceKind === "telefonki") {
    const normalized = trimmed.replace(/^TelefonKI:\s*/u, "").trim();
    return {
      reasonDescription: normalized,
      strippedPrefix: normalized === trimmed ? undefined : "TelefonKI",
    };
  }

  return { reasonDescription: trimmed, strippedPrefix: undefined };
}

function isTruthyLegacyFlag(value) {
  return value === 1 || value === "1" || value === true;
}

function isLegacyPkvDetailsComplete(pkv) {
  if (!pkv) {
    return false;
  }

  return (
    trimToUndefined(pkv.beihilfe)?.toLocaleLowerCase() !== "unbekannt" &&
    trimToUndefined(pkv.kasse)?.toLocaleLowerCase() !== "unbekannt" &&
    trimToUndefined(pkv.tarif)?.toLocaleLowerCase() !== "unbekannt"
  );
}

function readSourceMaps() {
  const personalByUser = new Map(
    readSqliteJson("select * from personal order by updated").map((row) => [
      row.user,
      row,
    ]),
  );
  const userById = new Map(
    readSqliteJson("select id, email from users order by created").map(
      (row) => [row.id, row],
    ),
  );
  const dataSharingByUser = Map.groupBy(
    readSqliteJson("select * from datenweitergabe order by created, id"),
    (row) => row.user,
  );
  const anamneseByUser = new Map(
    readSqliteJson("select * from anamnese order by updated").map((row) => [
      row.user,
      row,
    ]),
  );
  const anamneseTextByUser = new Map(
    readSqliteJson("select * from anamnesetexte order by updated").map(
      (row) => [row.user, row],
    ),
  );
  const pkvByUser = new Map(
    readSqliteJson("select * from pkv order by updated").map((row) => [
      row.user,
      row,
    ]),
  );
  const currentAppointmentsByUser = new Map(
    readSqliteJson(`
      select *
      from termine
      where user != '' and deleted = 0
      order by updated desc, created desc, id desc
    `).map((row) => [row.user, row]),
  );
  const baumByUser = new Map(
    readSqliteJson(`
      select *
      from baumdiagramm
      where user != ''
      order by updated desc, created desc, id desc
    `).map((row) => [row.user, row]),
  );
  const blockedUsers = readSqliteJson(`
    select distinct user as legacyUserId
    from baumdiagramm
    where isUserBlocked = 1 and user != ''
    order by user
  `);

  return {
    anamneseByUser,
    anamneseTextByUser,
    baumByUser,
    blockedUsers,
    currentAppointmentsByUser,
    dataSharingByUser,
    personalByUser,
    pkvByUser,
    userById,
  };
}

function readSnapshotExportedAt() {
  const [row] = readSqliteJson(`
    select max(ts) as ts
    from (
      select max(coalesce(updated, created)) as ts from baumdiagramm
      union all
      select max(coalesce(updated, created)) as ts from termine
      union all
      select max(coalesce(updated, created)) as ts from oldTermine
      union all
      select max(coalesce(updated, created)) as ts from personal
    )
  `);
  const value = trimToUndefined(row?.ts);
  if (!value) {
    throw new Error("Could not determine legacy snapshot export timestamp.");
  }
  return parseDate(value);
}

function inferLegacyUiStepForNewPatient(args) {
  if (!args.insuranceType) {
    return "new-insurance-type";
  }
  if (args.insuranceType === "gkv" && !args.hzvStatus) {
    return "new-gkv-hzv";
  }
  if (args.insuranceType === "pkv" && !args.pvsConsent) {
    return "new-pkv-consent";
  }
  if (args.insuranceType === "pkv" && !args.hasPkvDetails) {
    return "new-pkv-details";
  }
  if (!args.hasLegacyPersonalData) {
    return "personal-data";
  }
  if (!args.hasLegacyDataSharing) {
    return "data-sharing";
  }
  if (!args.hasLegacyMedicalHistory) {
    return "medical-history";
  }
  if (args.hasImportableConfirmation) {
    return "confirmation";
  }
  return "calendar-selection";
}

function inferLegacyUiStepForExistingPatient(args) {
  if (!args.practitionerName) {
    return "existing-doctor-selection";
  }
  if (!args.hasLegacyPersonalData) {
    return "personal-data";
  }
  if (args.hasImportableConfirmation) {
    return "confirmation";
  }
  return "calendar-selection";
}

function mapLegacyUiStepToSessionStep(args) {
  switch (args.legacyUiStep) {
    case "privacy":
      return "privacy";
    case "location":
      return "location";
    case "patient-status":
      return "patient-status";
    case "existing-doctor-selection":
      return "existing-doctor-selection";
    case "new-insurance-type":
      return "new-insurance-type";
    case "new-gkv-hzv":
      return "new-gkv-details";
    case "new-pkv-consent":
      return "new-pvs-consent";
    case "new-pkv-details":
      return "new-pkv-details";
    case "data-sharing":
      return "new-data-sharing";
    case "medical-history":
    case "personal-data":
      return args.isNewPatient ? "new-data-input" : "existing-data-input";
    case "calendar-selection":
      return args.isNewPatient
        ? "new-calendar-selection"
        : "existing-calendar-selection";
    case "confirmation":
      return args.isNewPatient ? "new-confirmation" : "existing-confirmation";
  }
}

function buildSnapshotReplayRow(
  userId,
  maps,
  currentMatchByLegacyAppointmentId,
) {
  const baum = maps.baumByUser.get(userId);
  if (!baum) {
    return undefined;
  }

  const userEmail =
    maps.userById.get(userId)?.email ?? `${userId}@legacy-users.invalid`;
  const currentAppointment = maps.currentAppointmentsByUser.get(userId);
  const currentMatch =
    currentAppointment === undefined
      ? undefined
      : currentMatchByLegacyAppointmentId.get(currentAppointment.id);
  const locationName =
    normalizeLocationName(baum.zweigstelle) ??
    normalizeLocationName(currentMatch?.legacyLocation) ??
    normalizeLocationName(currentMatch?.pvsLocationRoom);
  const legacyPractitionerDocId =
    trimToUndefined(currentAppointment?.doc) ?? trimToUndefined(baum.doc);
  const practitionerName = importedPractitionerNameFromLegacyDoc({
    docId: legacyPractitionerDocId,
    locationName,
  });
  const personalData = personalDataFromLegacyUser(userId, {
    allowPvsFallback: true,
    fallbackMatch: currentMatch,
    personalByUser: maps.personalByUser,
    userEmail,
  });
  const hasLegacyPersonalData = isLegacyPersonalDataComplete(
    userId,
    maps.personalByUser,
  );
  const dataSharingContacts = dataSharingContactsForUser(
    userId,
    maps.dataSharingByUser,
  );
  const hasLegacyDataSharing = isLegacyDataSharingComplete(
    userId,
    maps.dataSharingByUser,
  );
  const medicalHistory = medicalHistoryFromUser(
    userId,
    maps.anamneseByUser,
    maps.anamneseTextByUser,
  );
  const hasLegacyMedicalHistory = isLegacyMedicalHistoryComplete(
    userId,
    maps.anamneseByUser,
    maps.anamneseTextByUser,
  );
  const hasConsent = baum.datenschutz === 1;
  const isNewPatient = baum.neupatient === "ja";
  const hasKnownPatientStatus =
    baum.neupatient === "ja" || baum.neupatient === "nein";
  const pkv = maps.pkvByUser.get(userId);
  const pvsConsent = isTruthyLegacyFlag(baum.pvs);
  const insuranceType =
    hasKnownPatientStatus && isNewPatient
      ? normalizeInsuranceType({
          hasPkvRow: pkv !== undefined,
          kasse: baum.kasse,
          pvsConsent,
        })
      : undefined;
  const hzvStatus =
    insuranceType === "gkv"
      ? normalizeHzvStatus(baum.hausarztvertrag)
      : undefined;
  const pkvInsuranceType =
    insuranceType === "pkv" ? normalizePkvInsuranceType(pkv?.kasse) : undefined;
  const pkvTariff =
    insuranceType === "pkv" ? normalizePkvTariff(pkv?.tarif) : undefined;
  const beihilfeStatus =
    insuranceType === "pkv"
      ? normalizeBeihilfeStatus(pkv?.beihilfe)
      : undefined;
  const hasPkvDetails = isLegacyPkvDetailsComplete(pkv);
  const normalizedReason = normalizeImportedReasonDescription(
    currentMatch?.pvsReason,
    currentMatch?.sourceKind,
  );
  const reasonDescription = normalizedReason.reasonDescription;
  const hasMatchedAppointment =
    currentMatch !== undefined &&
    personalData !== undefined &&
    currentMatch.pvsPatientSourceId !== undefined &&
    currentMatch.pvsStart !== undefined &&
    currentMatch.pvsType !== undefined;
  const hasImportableConfirmation =
    hasMatchedAppointment && reasonDescription !== undefined;
  const legacyUiStep = !hasConsent
    ? "privacy"
    : !locationName
      ? "location"
      : !hasKnownPatientStatus
        ? "patient-status"
        : isNewPatient
          ? inferLegacyUiStepForNewPatient({
              hasImportableConfirmation,
              hasLegacyDataSharing,
              hasLegacyMedicalHistory,
              hasLegacyPersonalData,
              hasPkvDetails,
              hzvStatus,
              insuranceType,
              pvsConsent,
            })
          : inferLegacyUiStepForExistingPatient({
              hasImportableConfirmation,
              hasLegacyPersonalData,
              practitionerName,
            });
  const sessionStep = mapLegacyUiStepToSessionStep({
    isNewPatient,
    legacyUiStep,
  });

  const row = {
    createdAt: parseDate(baum.updated ?? baum.created).getTime(),
    dataSharingContacts,
    ...(beihilfeStatus === undefined ? {} : { beihilfeStatus }),
    ...(insuranceType === undefined ? {} : { insuranceType }),
    ...(hzvStatus === undefined ? {} : { hzvStatus }),
    ...(locationName === undefined ? {} : { locationName }),
    ...(medicalHistory === undefined ? {} : { medicalHistory }),
    ...(personalData === undefined ? {} : { personalData }),
    ...(pkvInsuranceType === undefined ? {} : { pkvInsuranceType }),
    ...(pkvTariff === undefined ? {} : { pkvTariff }),
    ...(practitionerName === undefined ? {} : { practitionerName }),
    ...(insuranceType !== "pkv" || !pvsConsent ? {} : { pvsConsent: true }),
    legacyUiStep,
    reasonDescription,
    sessionStep,
    source: "legacy-online",
    sourceSessionKey: `legacy-pocketbase:snapshot:${userId}`,
    userAuthId: `legacy-pocketbase:${userId}`,
    userEmail,
  };

  if (!sessionStep.endsWith("confirmation")) {
    return {
      replayRow: row,
      strippedPrefix: undefined,
    };
  }
  if (!currentMatch || !reasonDescription) {
    return undefined;
  }

  return {
    replayRow: {
      ...row,
      bookedDurationMinutes: durationMinutes(
        currentMatch.pvsStart,
        currentMatch.pvsEnd,
      ),
      legacyAppointmentId: currentMatch.legacyAppointmentId,
      pvsAppointmentStart: toStoredPvsDateTime(currentMatch.pvsStart),
      pvsAppointmentTypeTitle: currentMatch.pvsType,
      pvsPatientNumber: Number(currentMatch.pvsPatientSourceId),
    },
    strippedPrefix: normalizedReason.strippedPrefix,
  };
}

function buildUnmatchedFutureBookingHoldRows(
  snapshotExportedAt,
  unmatchedRows,
) {
  return unmatchedRows
    .filter(
      (row) =>
        row.sourceKind === "online" &&
        trimToUndefined(row.legacyIdentityId) !== undefined &&
        parseDate(row.legacyStart).getTime() > snapshotExportedAt.getTime(),
    )
    .map((row) => {
      const legacyIdentityId = trimToUndefined(row.legacyIdentityId);
      if (!legacyIdentityId) {
        return undefined;
      }

      const practitionerName = trimToUndefined(
        [
          trimToUndefined(row.legacyDoctorFirstName),
          trimToUndefined(row.legacyDoctorLastName),
        ]
          .filter(Boolean)
          .join(" "),
      );
      const userEmail =
        trimToUndefined(row.legacyUserEmail) ??
        `${legacyIdentityId}@legacy-users.invalid`;

      return {
        createdAt: snapshotExportedAt.getTime(),
        end: toStoredLegacyDateTime(row.legacyEnd),
        legacyAppointmentId: row.legacyAppointmentId,
        ...(trimToUndefined(row.legacyTitle) === undefined
          ? {}
          : { legacyTitle: row.legacyTitle.trim() }),
        ...(trimToUndefined(row.legacyType) === undefined
          ? {}
          : { legacyType: row.legacyType.trim() }),
        ...(normalizeLocationName(row.legacyLocation) === undefined
          ? {}
          : { locationName: normalizeLocationName(row.legacyLocation) }),
        ...(practitionerName === undefined ? {} : { practitionerName }),
        sourceSessionKey: `legacy-pocketbase:unmatched-future-hold:${row.legacyAppointmentId}`,
        sourceSystem: "legacy-online",
        start: toStoredLegacyDateTime(row.legacyStart),
        userAuthId: `legacy-pocketbase:${legacyIdentityId}`,
        userEmail,
      };
    })
    .filter(Boolean);
}

function main() {
  mkdirSync(reportRoot, { recursive: true });
  const matches = parseCsv(readFileSync(matchesPath, "utf8"));
  const unmatched = parseCsv(readFileSync(unmatchedPath, "utf8"));
  const maps = readSourceMaps();
  const snapshotExportedAt = readSnapshotExportedAt();

  const currentOnlineMatches = new Map(
    matches
      .filter((match) => match.sourceKind === "online")
      .map((match) => [match.legacyAppointmentId, match]),
  );
  const snapshotReplayEntries = [...maps.baumByUser.keys()]
    .map((userId) => buildSnapshotReplayRow(userId, maps, currentOnlineMatches))
    .filter(Boolean);
  const replayRows = snapshotReplayEntries.map((entry) => entry.replayRow);
  const strippedReasonPrefixCounts = Object.fromEntries(
    [
      ...Map.groupBy(
        snapshotReplayEntries
          .map((entry) => entry.strippedPrefix)
          .filter(Boolean),
        (prefix) => prefix,
      ).entries(),
    ]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([prefix, rows]) => [prefix, rows.length]),
  );
  const appointmentLinkedReplayRows = replayRows.filter(
    (row) => row.legacyAppointmentId !== undefined,
  );
  const unmatchedFutureBookingHoldRows = buildUnmatchedFutureBookingHoldRows(
    snapshotExportedAt,
    unmatched,
  );

  const blockRows = maps.blockedUsers.map((row) => ({
    legacyUserId: row.legacyUserId,
    reason: "Legacy baumdiagramm.isUserBlocked",
    userAuthId: `legacy-pocketbase:${row.legacyUserId}`,
    userEmail: `${row.legacyUserId}@legacy-users.invalid`,
  }));

  writeJsonl(
    join(reportRoot, "legacy-booking-step-replay.source.jsonl"),
    replayRows,
  );
  writeJsonl(
    join(reportRoot, "legacy-unmatched-future-booking-holds.source.jsonl"),
    unmatchedFutureBookingHoldRows,
  );
  writeJsonl(join(reportRoot, "legacy-booking-blocks.source.jsonl"), blockRows);
  console.log(
    JSON.stringify(
      {
        appointmentLinkedReplayRows: appointmentLinkedReplayRows.length,
        blockedUsers: blockRows.length,
        legacyUiSteps: Object.fromEntries(
          [...Map.groupBy(replayRows, (row) => row.legacyUiStep).entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([step, rows]) => [step, rows.length]),
        ),
        replayRows: replayRows.length,
        replayRowsBySource: Object.fromEntries(
          [...Map.groupBy(replayRows, (row) => row.source).entries()].map(
            ([source, rows]) => [source, rows.length],
          ),
        ),
        replayRowsByStep: Object.fromEntries(
          [...Map.groupBy(replayRows, (row) => row.sessionStep).entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([step, rows]) => [step, rows.length]),
        ),
        snapshotReplayRows: snapshotReplayEntries.length,
        snapshotExportedAt: snapshotExportedAt.toISOString(),
        strippedReasonPrefixCounts,
        strippedReasonPrefixes: Object.values(
          strippedReasonPrefixCounts,
        ).reduce((sum, count) => sum + count, 0),
        unmatchedFutureBookingHolds: unmatchedFutureBookingHoldRows.length,
      },
      null,
      2,
    ),
  );
}

main();

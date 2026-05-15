import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const legacyDbPath = join(workspaceRoot, ".cache/migration/source/data.db");
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const matchesPath = join(
  reportRoot,
  "legacy-appointment-correlation-matches.csv",
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

function toStoredPvsDateTime(value) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/,
  );
  if (!match) {
    throw new Error(`Unsupported Praxistimer datetime: ${value}`);
  }
  return `${match[1]}T${match[2]}${match[3]}[Europe/Berlin]`;
}

function parseOffsetDate(value) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d{3}Z| ([+-]\d{2}:\d{2}))$/,
  );
  if (!match) {
    throw new Error(`Unsupported date: ${value}`);
  }
  const suffix = match[3] ?? "Z";
  return new Date(`${match[1]}T${match[2]}${suffix}`);
}

function durationMinutes(start, end) {
  const minutes =
    (parseOffsetDate(end).getTime() - parseOffsetDate(start).getTime()) /
    60_000;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
}

function personalDataFromMatch(match, personalByUser, phoneUserById) {
  if (match.sourceKind === "telefonki") {
    const phoneUser = phoneUserById.get(match.legacyIdentityId);
    return {
      dateOfBirth: normalizeDate(match.birthDate),
      firstName: match.patientFirstName,
      gender: normalizeGender(phoneUser?.geschlecht),
      lastName: match.patientLastName,
      phoneNumber: phoneUser?.phone ?? "",
    };
  }

  const personal = personalByUser.get(match.legacyIdentityId);
  return {
    city: personal?.ort ?? "",
    dateOfBirth: normalizeDate(match.birthDate),
    email: normalizeEmail(
      match.legacyUserEmail,
      match.legacyIdentityId,
      "legacy-users.invalid",
    ),
    firstName: match.patientFirstName,
    gender: normalizeGender(personal?.geschlecht),
    lastName: match.patientLastName,
    phoneNumber: personal?.tel ?? "",
    postalCode: personal?.plz ?? "",
    street: personal?.strasse ?? "",
    ...(personal?.dr ? { title: personal.dr } : {}),
  };
}

function dataSharingContactsForMatch(match, dataSharingByUser) {
  if (match.sourceKind === "telefonki") {
    return [];
  }

  return (dataSharingByUser.get(match.legacyIdentityId) ?? []).map(
    (contact) => ({
      city: contact.ort ?? "",
      dateOfBirth: normalizeDate(contact.geburtstag),
      firstName: contact.vorname ?? "",
      gender: normalizeGender(contact.geschlecht),
      lastName: contact.name ?? "",
      phoneNumber: contact.tel ?? "",
      postalCode: contact.plz ?? "",
      street: contact.str ?? "",
      ...(contact.dr ? { title: contact.dr } : {}),
    }),
  );
}

function sourceForKind(sourceKind) {
  return sourceKind === "telefonki" ? "telefonki" : "legacy-pocketbase";
}

function userAuthIdForMatch(match) {
  return match.sourceKind === "telefonki"
    ? `telefonki:${match.legacyIdentityId}`
    : `legacy-pocketbase:${match.legacyIdentityId}`;
}

function userEmailForMatch(match) {
  return match.sourceKind === "telefonki"
    ? `${match.legacyIdentityId}@telefonki-users.invalid`
    : normalizeEmail(
        match.legacyUserEmail,
        match.legacyIdentityId,
        "legacy-users.invalid",
      );
}

function readSourceMaps() {
  const personalByUser = new Map(
    readSqliteJson("select * from personal order by updated").map((row) => [
      row.user,
      row,
    ]),
  );
  const phoneUserById = new Map(
    readSqliteJson("select * from phoneusers order by updated").map((row) => [
      row.id,
      row,
    ]),
  );
  const dataSharingByUser = Map.groupBy(
    readSqliteJson("select * from datenweitergabe order by created, id"),
    (row) => row.user,
  );
  const blockedUsers = readSqliteJson(`
    select distinct user as legacyUserId
    from baumdiagramm
    where isUserBlocked = 1 and user != ''
    order by user
  `);

  return { blockedUsers, dataSharingByUser, personalByUser, phoneUserById };
}

function main() {
  mkdirSync(reportRoot, { recursive: true });
  const matches = parseCsv(readFileSync(matchesPath, "utf8"));
  const { blockedUsers, dataSharingByUser, personalByUser, phoneUserById } =
    readSourceMaps();

  const replayRows = matches.map((match) => ({
    bookedDurationMinutes: durationMinutes(match.pvsStart, match.pvsEnd),
    createdAt: parseOffsetDate(match.legacyStart).getTime(),
    dataSharingContacts: dataSharingContactsForMatch(match, dataSharingByUser),
    legacyAppointmentId: match.legacyAppointmentId,
    personalData: personalDataFromMatch(match, personalByUser, phoneUserById),
    pvsAppointmentStart: toStoredPvsDateTime(match.pvsStart),
    pvsAppointmentTypeTitle: match.pvsType,
    pvsPatientNumber: Number(match.pvsPatientSourceId),
    reasonDescription:
      match.legacyType || match.legacyTitle || match.pvsReason || "Import",
    source: sourceForKind(match.sourceKind),
    sourceSessionKey: `${sourceForKind(match.sourceKind)}:${match.legacyAppointmentId}`,
    userAuthId: userAuthIdForMatch(match),
    userEmail: userEmailForMatch(match),
  }));

  const blockRows = blockedUsers.map((row) => ({
    legacyUserId: row.legacyUserId,
    reason: "Legacy baumdiagramm.isUserBlocked",
    userAuthId: `legacy-pocketbase:${row.legacyUserId}`,
    userEmail: `${row.legacyUserId}@legacy-users.invalid`,
  }));

  writeJsonl(
    join(reportRoot, "legacy-booking-step-replay.source.jsonl"),
    replayRows,
  );
  writeJsonl(join(reportRoot, "legacy-booking-blocks.source.jsonl"), blockRows);
  console.log(
    JSON.stringify(
      {
        blockedUsers: blockRows.length,
        replayRows: replayRows.length,
        replayRowsBySource: Object.fromEntries(
          [...Map.groupBy(replayRows, (row) => row.source).entries()].map(
            ([source, rows]) => [source, rows.length],
          ),
        ),
      },
      null,
      2,
    ),
  );
}

main();

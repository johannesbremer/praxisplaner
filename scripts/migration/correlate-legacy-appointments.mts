import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const legacyDbPath = join(workspaceRoot, ".cache/migration/source/data.db");
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const pvsAppointmentsPath = migrationSourcePath("old-appointments.csv");

function migrationSourcePath(fileName) {
  const rootPath = join(workspaceRoot, fileName);
  if (existsSync(rootPath)) {
    return rootPath;
  }
  return join(workspaceRoot, ".cache/migration/source", fileName);
}

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

function normalizePatientSearchText(value) {
  return value.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase();
}

function normalizedNameMatch(onlineName, sourceOfTruthName) {
  const online = normalizePatientSearchText(onlineName);
  const sourceOfTruth = normalizePatientSearchText(sourceOfTruthName);

  return (
    online.length > 0 &&
    sourceOfTruth.length > 0 &&
    sourceOfTruth.includes(online)
  );
}

function parsePvsWallClock(value) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/,
  );
  if (!match) {
    throw new Error(`Unsupported Praxistimer datetime: ${value}`);
  }
  return `${match[1]}T${match[2]}`;
}

function parseLegacyWallClock(value) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.\d{3}Z$/,
  );
  if (!match) {
    throw new Error(`Unsupported legacy datetime: ${value}`);
  }
  return `${match[1]}T${match[2]}`;
}

function startWallClockKey(fields) {
  return fields.startWallClock;
}

function isExcludedResourceRoom(room) {
  return /\b(?:ekg|labor|mufu)\b/iu.test(room);
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/u.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function writeCsv(path, rows) {
  const headers = Object.keys(rows[0] ?? { empty: "" });
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function writeJsonl(path, rows) {
  writeFileSync(
    path,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length > 0 ? "\n" : ""),
  );
}

function readSqliteJson(query) {
  const output = execFileSync("sqlite3", ["-json", legacyDbPath, query], {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  if (output.length === 0) {
    return [];
  }

  return JSON.parse(output);
}

function buildPvsIndex() {
  const rows = parseCsv(readFileSync(pvsAppointmentsPath, "utf8"));
  const index = new Map();
  let excludedResourceRoomRows = 0;
  let indexableRows = 0;

  for (const row of rows) {
    if (!row.Vorname.trim() || !row.Nachname.trim()) {
      continue;
    }
    if (isExcludedResourceRoom(row.Raum)) {
      excludedResourceRoomRows += 1;
      continue;
    }

    const appointment = {
      doctor: row.Arzt,
      end: row.Ende,
      endWallClock: parsePvsWallClock(row.Ende),
      firstName: normalizePatientSearchText(row.Vorname),
      lastName: normalizePatientSearchText(row.Nachname),
      locationRoom: row.Raum,
      patientSourceId: row.ID,
      reason: row.Termingrund,
      start: row.Beginn,
      startWallClock: parsePvsWallClock(row.Beginn),
      type: row.Terminart,
    };
    const key = startWallClockKey(appointment);
    const bucket = index.get(key) ?? [];
    bucket.push(appointment);
    index.set(key, bucket);
    indexableRows += 1;
  }

  return { excludedResourceRoomRows, index, indexableRows, rows: rows.length };
}

function readOnlineAppointments() {
  return readSqliteJson(`
    select
      'online' as sourceKind,
      t.id as legacyAppointmentId,
      t.start as legacyStart,
      t.end as legacyEnd,
      t.title as legacyTitle,
      t.user as legacyIdentityId,
      t.parentID as legacyParentId,
      t.zweigstelle as legacyLocation,
      d.Nachname as legacyDoctorLastName,
      d.Vorname as legacyDoctorFirstName,
      ta.title as legacyType,
      p.id as legacyProfileId,
      u.email as legacyUserEmail,
      p.vorname as firstName,
      p.name as lastName,
      p.geburtstag as birthDate
    from termine t
    join personal p on p.user = t.user
    left join users u on u.id = t.user
    left join docs d on d.id = t.doc
    left join terminarten ta on ta.id = t.terminart
    where t.user != ''
    order by t.start, t.id
  `);
}

function readOldOnlineAppointments() {
  return readSqliteJson(`
    select
      'online_old' as sourceKind,
      ot.id as legacyAppointmentId,
      ot.datetime as legacyStart,
      ot.datetime as legacyEnd,
      ta.title as legacyTitle,
      ot.user as legacyIdentityId,
      ot.termin as legacyParentId,
      '' as legacyLocation,
      '' as legacyDoctorLastName,
      '' as legacyDoctorFirstName,
      ta.title as legacyType,
      p.id as legacyProfileId,
      u.email as legacyUserEmail,
      coalesce(nullif(ot.vorname, ''), p.vorname, '') as firstName,
      coalesce(nullif(ot.name, ''), p.name, '') as lastName,
      coalesce(nullif(ot.geburtsdatum, ''), p.geburtstag, '') as birthDate
    from oldTermine ot
    left join personal p on p.user = ot.user
    left join users u on u.id = ot.user
    left join terminarten ta on ta.id = ot.art
    where ot.user != ''
    order by ot.datetime, ot.id
  `);
}

function readTelefonkiAppointments() {
  return readSqliteJson(`
    select
      'telefonki' as sourceKind,
      t.id as legacyAppointmentId,
      t.start as legacyStart,
      t.end as legacyEnd,
      t.title as legacyTitle,
      t.phoneusers as legacyIdentityId,
      t.parentID as legacyParentId,
      t.zweigstelle as legacyLocation,
      d.Nachname as legacyDoctorLastName,
      d.Vorname as legacyDoctorFirstName,
      ta.title as legacyType,
      ph.id as legacyProfileId,
      ph.vorname as firstName,
      ph.nachname as lastName,
      ph.geburtsdatum as birthDate
    from termine t
    join phoneusers ph on ph.id = t.phoneusers
    left join docs d on d.id = t.doc
    left join terminarten ta on ta.id = t.terminart
    where t.phoneusers != ''
    order by t.start, t.id
  `);
}

function readLegacyUsers() {
  return readSqliteJson(`
    select
      id as sourceUserId,
      email,
      username,
      verified
    from users
    order by id
  `);
}

function classifyAppointments(legacyRows, pvsIndex) {
  const matches = [];
  const ambiguous = [];
  const unmatched = [];
  let missingName = 0;

  for (const row of legacyRows) {
    const firstName = normalizePatientSearchText(row.firstName ?? "");
    const lastName = normalizePatientSearchText(row.lastName ?? "");
    if (!firstName.trim() || !lastName.trim()) {
      missingName += 1;
      unmatched.push({ ...row, reason: "missing_name" });
      continue;
    }

    const startWallClock = parseLegacyWallClock(row.legacyStart);
    const endWallClock = parseLegacyWallClock(row.legacyEnd);
    const candidates = pvsIndex
      .get(startWallClockKey({ startWallClock }))
      ?.filter(
        (candidate) =>
          normalizedNameMatch(firstName, candidate.firstName) &&
          normalizedNameMatch(lastName, candidate.lastName),
      );

    if (!candidates || candidates.length === 0) {
      unmatched.push({
        ...row,
        reason: "no_exact_start_and_source_of_truth_substring_name_match",
      });
      continue;
    }

    if (candidates.length > 1) {
      ambiguous.push({
        ...row,
        candidateCount: candidates.length,
        reason:
          "multiple_pvs_rows_for_exact_start_and_source_of_truth_substring_name",
      });
      continue;
    }

    const [candidate] = candidates;
    matches.push({
      birthDate: row.birthDate,
      endMatches: candidate.endWallClock === endWallClock,
      legacyAppointmentId: row.legacyAppointmentId,
      legacyDoctor: [row.legacyDoctorFirstName, row.legacyDoctorLastName]
        .filter(Boolean)
        .join(" "),
      legacyEnd: row.legacyEnd,
      legacyIdentityId: row.legacyIdentityId,
      legacyLocation: row.legacyLocation,
      legacyProfileId: row.legacyProfileId,
      legacyStart: row.legacyStart,
      legacyTitle: row.legacyTitle,
      legacyType: row.legacyType,
      legacyUserEmail: row.legacyUserEmail,
      matchRule:
        "exact_local_wall_clock_start_and_source_of_truth_substring_first_last_name",
      patientFirstName: firstName,
      patientLastName: lastName,
      pvsDoctor: candidate.doctor,
      pvsEnd: candidate.end,
      pvsLocationRoom: candidate.locationRoom,
      pvsPatientSourceId: candidate.patientSourceId,
      pvsReason: candidate.reason,
      pvsStart: candidate.start,
      pvsType: candidate.type,
      sourceKind: row.sourceKind,
    });
  }

  return { ambiguous, matches, missingName, unmatched };
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = row[key] ?? "";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function countMatchesWhere(rows, predicate) {
  return rows.filter(predicate).length;
}

function bookingIdentityKind(sourceKind) {
  return sourceKind === "telefonki" ? "telefonki" : "online";
}

function bookingIdentitySourceSystem(sourceKind) {
  return sourceKind === "telefonki" ? "legacy-telefonki" : "legacy-online";
}

function bookingIdentitySourceId(row) {
  return row.legacyProfileId || row.legacyIdentityId;
}

function bookingIdentitySourceKey(row) {
  return [
    bookingIdentitySourceSystem(row.sourceKind),
    bookingIdentityKind(row.sourceKind),
    bookingIdentitySourceId(row),
  ].join(":");
}

function buildBookingIdentityRows(legacyRows) {
  const bySourceKey = new Map();

  for (const row of legacyRows) {
    const sourceIdentityId = bookingIdentitySourceId(row);
    if (!sourceIdentityId) {
      continue;
    }

    const sourceKey = bookingIdentitySourceKey(row);
    if (bySourceKey.has(sourceKey)) {
      continue;
    }

    bySourceKey.set(sourceKey, {
      dateOfBirth: row.birthDate,
      firstName: row.firstName,
      kind: bookingIdentityKind(row.sourceKind),
      lastName: row.lastName,
      sourceIdentityId,
      sourceKey,
      sourceSystem: bookingIdentitySourceSystem(row.sourceKind),
      ...(row.sourceKind === "telefonki"
        ? {}
        : {
            userEmail: row.legacyUserEmail,
            userSourceId: row.legacyIdentityId,
          }),
    });
  }

  return [...bySourceKey.values()].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
}

function buildAssociationRows(matches) {
  const byAssociationKey = new Map();

  for (const match of matches) {
    if (match.endMatches !== true) {
      continue;
    }
    const sourceKey = bookingIdentitySourceKey(match);
    const associationKey = `${sourceKey}:pvs:${match.pvsPatientSourceId}`;
    const existing = byAssociationKey.get(associationKey);
    if (existing) {
      existing.evidenceCount += 1;
      continue;
    }

    byAssociationKey.set(associationKey, {
      associationKey,
      bookingIdentitySourceKey: sourceKey,
      evidenceCount: 1,
      legacyAppointmentId: match.legacyAppointmentId,
      legacyIdentityId: match.legacyIdentityId,
      method: "automatic",
      pvsAppointmentSourceKey: [
        match.pvsStart,
        match.pvsPatientSourceId,
        match.pvsType,
      ].join("|"),
      pvsPatientNumber: Number(match.pvsPatientSourceId),
      status: "active",
    });
  }

  return [...byAssociationKey.values()].sort((left, right) =>
    left.associationKey.localeCompare(right.associationKey),
  );
}

function countAssociationConflicts(associationRows) {
  const patientNumbersByIdentity = Map.groupBy(
    associationRows,
    (row) => row.bookingIdentitySourceKey,
  );
  return [...patientNumbersByIdentity.values()].filter(
    (rows) => new Set(rows.map((row) => row.pvsPatientNumber)).size > 1,
  ).length;
}

function splitAssociationRowsByConflict(associationRows) {
  const rowsByIdentity = Map.groupBy(
    associationRows,
    (row) => row.bookingIdentitySourceKey,
  );
  const appendOnlyRows = [];
  const conflictRows = [];

  for (const rows of rowsByIdentity.values()) {
    const pvsPatientNumbers = new Set(rows.map((row) => row.pvsPatientNumber));
    if (pvsPatientNumbers.size === 1) {
      appendOnlyRows.push(...rows);
      continue;
    }
    conflictRows.push(...rows.map((row) => ({ ...row, status: "review" })));
  }

  return {
    appendOnlyRows: appendOnlyRows.sort((left, right) =>
      left.associationKey.localeCompare(right.associationKey),
    ),
    conflictRows: conflictRows.sort((left, right) =>
      left.associationKey.localeCompare(right.associationKey),
    ),
  };
}

function main() {
  mkdirSync(reportRoot, { recursive: true });

  const pvs = buildPvsIndex();
  const legacyRows = [
    ...readOnlineAppointments(),
    ...readOldOnlineAppointments(),
    ...readTelefonkiAppointments(),
  ];
  const result = classifyAppointments(legacyRows, pvs.index);
  const legacyUserRows = readLegacyUsers().map((user) => ({
    authId: `legacy-pocketbase:${user.sourceUserId}`,
    email:
      typeof user.email === "string" && user.email.includes("@")
        ? user.email
        : `${user.sourceUserId}@legacy-users.invalid`,
    sourceUserId: user.sourceUserId,
    username: user.username,
    verified: user.verified === 1,
  }));
  const bookingIdentityRows = buildBookingIdentityRows(legacyRows);
  const associationRows = buildAssociationRows(result.matches);
  const { appendOnlyRows, conflictRows } =
    splitAssociationRowsByConflict(associationRows);
  const automaticMatchCount = result.matches.length;
  const onlineSourceKinds = new Set(["online", "online_old"]);
  const summary = {
    automaticMatchCount,
    automaticLegacyOnlineMatchCount: countMatchesWhere(result.matches, (row) =>
      onlineSourceKinds.has(row.sourceKind),
    ),
    automaticMatchedRowsWithDifferentEnd: countMatchesWhere(
      result.matches,
      (row) => row.endMatches === false,
    ),
    automaticMatchedRowsWithSameEnd: countMatchesWhere(
      result.matches,
      (row) => row.endMatches === true,
    ),
    automaticMatchesBySource: countBy(result.matches, "sourceKind"),
    ambiguousCount: result.ambiguous.length,
    bookingIdentityAssociationConflictCount:
      countAssociationConflicts(associationRows),
    bookingIdentityAssociationConflictRowCount: conflictRows.length,
    bookingIdentityAssociationCount: appendOnlyRows.length,
    bookingIdentityAssociationSkippedForConflictCount: conflictRows.length,
    bookingIdentityCount: bookingIdentityRows.length,
    legacyOnlineAppointmentCount: countMatchesWhere(legacyRows, (row) =>
      onlineSourceKinds.has(row.sourceKind),
    ),
    legacyAppointmentCount: legacyRows.length,
    legacyAppointmentsBySource: countBy(legacyRows, "sourceKind"),
    legacyUserCount: legacyUserRows.length,
    matchPolicy:
      "Automatic identity correlation requires one non-resource Praxistimer row with the same local wall-clock start whose trimmed lowercase first and last names contain the corresponding trimmed lowercase online names. Automatic patient association additionally requires an exact matching end time. Praxistimer EKG, Labor, and Mufu rooms are excluded from candidate matching.",
    missingNameCount: result.missingName,
    pvsAppointmentCount: pvs.rows,
    pvsExcludedResourceRoomAppointmentCount: pvs.excludedResourceRoomRows,
    pvsIndexableAppointmentCount: pvs.indexableRows,
    unmatchedCount: result.unmatched.length,
    unmatchedCountBySource: countBy(result.unmatched, "sourceKind"),
  };

  writeFileSync(
    join(reportRoot, "legacy-appointment-correlation-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  writeCsv(
    join(reportRoot, "legacy-appointment-correlation-matches.csv"),
    result.matches,
  );
  writeCsv(
    join(reportRoot, "legacy-appointment-correlation-ambiguous.csv"),
    result.ambiguous,
  );
  writeCsv(
    join(reportRoot, "legacy-appointment-correlation-unmatched.csv"),
    result.unmatched,
  );
  writeJsonl(
    join(reportRoot, "booking-identities.source.jsonl"),
    bookingIdentityRows,
  );
  writeJsonl(join(reportRoot, "legacy-users.source.jsonl"), legacyUserRows);
  writeJsonl(
    join(reportRoot, "booking-identity-patient-associations.source.jsonl"),
    appendOnlyRows,
  );
  writeJsonl(
    join(
      reportRoot,
      "booking-identity-patient-association-conflicts.source.jsonl",
    ),
    conflictRows,
  );

  console.log(JSON.stringify(summary, null, 2));
}

main();

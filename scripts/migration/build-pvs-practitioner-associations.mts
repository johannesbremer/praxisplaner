import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const appointmentDocumentsPath = join(
  workspaceRoot,
  ".cache/migration/reports/production-appointments.documents.jsonl",
);
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const associationPath = join(
  reportRoot,
  "pvs-patient-practitioner-associations.source.jsonl",
);
const tiePath = join(
  reportRoot,
  "pvs-patient-practitioner-association-ties.source.jsonl",
);
const lowSignalAppointmentTypes = new Set(["erkaltung", "magen-darm"]);

function normalizeAppointmentType(value) {
  return value
    .trim()
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function writeJsonl(path, rows) {
  writeFileSync(
    path,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length === 0 ? "" : "\n"),
  );
}

async function readAppointmentHistoryCounts() {
  const countsByPatient = new Map();
  const stats = {
    excludedLowSignalAppointmentTypeRows: 0,
    missingPatientRows: 0,
    practitionerRows: 0,
    resourceRows: 0,
    totalRows: 0,
  };
  const lines = createInterface({
    input: createReadStream(appointmentDocumentsPath),
  });

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    stats.totalRows += 1;
    const appointment = JSON.parse(line);
    if (typeof appointment.patientId !== "string") {
      stats.missingPatientRows += 1;
      continue;
    }
    if (
      lowSignalAppointmentTypes.has(
        normalizeAppointmentType(appointment.appointmentTypeTitle ?? ""),
      )
    ) {
      stats.excludedLowSignalAppointmentTypeRows += 1;
      continue;
    }
    const practitionerLineageKey =
      appointment.occupancyScope?.kind === "practitioner"
        ? appointment.occupancyScope.practitionerLineageKey
        : undefined;
    if (typeof practitionerLineageKey !== "string") {
      stats.resourceRows += 1;
      continue;
    }

    stats.practitionerRows += 1;
    const counts = countsByPatient.get(appointment.patientId) ?? new Map();
    counts.set(
      practitionerLineageKey,
      (counts.get(practitionerLineageKey) ?? 0) + 1,
    );
    countsByPatient.set(appointment.patientId, counts);
  }

  return { countsByPatient, stats };
}

function resolveClearWinners(countsByPatient) {
  const associations = [];
  const ties = [];

  for (const [patientId, practitionerCounts] of countsByPatient) {
    const ranked = [...practitionerCounts.entries()].toSorted((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    });
    const [best, second] = ranked;
    if (!best) {
      continue;
    }
    if (best[1] === second?.[1]) {
      ties.push({
        patientId,
        tiedPractitionerLineageKeys: ranked
          .filter((entry) => entry[1] === best[1])
          .map(([practitionerLineageKey]) => practitionerLineageKey),
        tiedAppointmentCount: best[1],
      });
      continue;
    }
    associations.push({
      matchedAppointmentCount: best[1],
      patientId,
      practitionerLineageKey: best[0],
    });
  }

  associations.sort((left, right) =>
    left.patientId.localeCompare(right.patientId),
  );
  ties.sort((left, right) => left.patientId.localeCompare(right.patientId));
  return { associations, ties };
}

async function main() {
  mkdirSync(reportRoot, { recursive: true });
  const { countsByPatient, stats } = await readAppointmentHistoryCounts();
  const { associations, ties } = resolveClearWinners(countsByPatient);

  writeJsonl(associationPath, associations);
  writeJsonl(tiePath, ties);
  console.log(
    JSON.stringify(
      {
        ...stats,
        associationPath,
        clearWinnerAssociations: associations.length,
        patientsWithPractitionerRows: countsByPatient.size,
        tiePath,
        ties: ties.length,
      },
      null,
      2,
    ),
  );
}

await main();

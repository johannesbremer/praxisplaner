import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const termineRoot = "/Users/johannes/Code/termine";
const defaultInputPath = resolveInputPath("pttermine.csv");
const defaultOutputPath = join(
  workspaceRoot,
  ".cache/migration/source/old-appointments.csv",
);

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    inputPath: args[0] ?? defaultInputPath,
    outputPath: args[1] ?? defaultOutputPath,
  };
}

function decodeWindows1252(path) {
  return execFileSync(
    "iconv",
    ["-f", "WINDOWS-1252", "-t", "UTF-8//IGNORE", path],
    {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );
}

function resolveInputPath(fileName) {
  for (const candidate of [
    join(workspaceRoot, ".cache/migration/source", fileName),
    join(workspaceRoot, fileName),
    join(termineRoot, fileName),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return join(workspaceRoot, ".cache/migration/source", fileName);
}

function parseSemicolonRows(text) {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replaceAll('"', "").split(";"));
}

function formatPraxistimerDate(date, time) {
  const match = `${date}_${time}`.match(
    /^(\d{2})\.(\d{2})\.(\d{4})_(\d{2}):(\d{2})$/,
  );
  if (!match) {
    throw new Error(`Unsupported Praxistimer date/time: ${date} ${time}`);
  }
  const isoWithoutOffset = `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00`;
  const offset = getBerlinOffset(isoWithoutOffset);
  return `${match[3]}-${match[2]}-${match[1]} ${match[4]}:${match[5]}:00 ${offset}`;
}

function getBerlinOffset(isoWithoutOffset) {
  const utcDate = new Date(`${isoWithoutOffset}Z`);
  const offsetParts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Europe/Berlin",
    timeZoneName: "longOffset",
  }).formatToParts(utcDate);
  const timeZoneName = offsetParts.find((part) => part.type === "timeZoneName");
  return timeZoneName?.value.replace("GMT", "") ?? "+01:00";
}

function csvCell(value) {
  if (/[",\n\r]/u.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function main() {
  const { inputPath, outputPath } = parseArgs();
  const rows = parseSemicolonRows(decodeWindows1252(inputPath));
  const records = rows.slice(1).flatMap((row) => {
    const [
      Datum,
      Beginn,
      Ende,
      Arzt,
      Raum,
      Terminart,
      ,
      Nachname,
      Vorname,
      Titel,
      ID,
      ,
      Termingrund,
    ] = row;
    if (!Datum || !Beginn || !Ende) {
      return [];
    }
    return [
      {
        Arzt: Arzt ?? "",
        Beginn: formatPraxistimerDate(Datum, Beginn),
        Ende: formatPraxistimerDate(Datum, Ende),
        ID: ID ?? "",
        Nachname: Nachname ?? "",
        Raum: Raum ?? "",
        Terminart: Terminart ?? "",
        Termingrund: Termingrund ?? "",
        Titel: Titel ?? "",
        Vorname: Vorname ?? "",
      },
    ];
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  const headers = [
    "Beginn",
    "Ende",
    "Arzt",
    "Raum",
    "Terminart",
    "Nachname",
    "Vorname",
    "Titel",
    "ID",
    "Termingrund",
  ];
  writeFileSync(
    outputPath,
    [
      headers.join(","),
      ...records.map((record) =>
        headers.map((header) => csvCell(record[header] ?? "")).join(","),
      ),
    ].join("\n") + "\n",
  );
  console.log(`Wrote ${records.length} appointments to ${outputPath}`);
}

main();

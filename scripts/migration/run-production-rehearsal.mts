import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import {
  type ReferenceImportRows,
  buildReferenceImportRows,
} from "./reference-import-shaping.mts";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const reportRoot = join(workspaceRoot, ".cache/migration/reports");
const sourceRoot = join(workspaceRoot, ".cache/migration/source");
const defaultManifestPath = join(reportRoot, "production-rehearsal-plan.json");
const defaultReferencesManifestPath = join(
  reportRoot,
  "production-rehearsal-references.json",
);
const defaultPatientsManifestPath = join(
  reportRoot,
  "production-rehearsal-patients.json",
);
const defaultResetManifestPath = join(
  reportRoot,
  "production-rehearsal-reset.json",
);
const defaultAdminKeyEnvName = "CONVEX_ADMIN_KEY";

const describeTarget = makeFunctionReference<
  "query",
  { practiceId: string },
  ProductionTargetDescription
>("migrationRehearsal:describeProductionRehearsalTarget");

const replaceReferenceTables = makeFunctionReference<
  "mutation",
  {
    appointmentTypes: { duration: number; name: string }[];
    locations: string[];
    practiceId: string;
    practitioners: string[];
    ruleSetId: string;
  },
  {
    appointmentTypes: number;
    locations: number;
    practitioners: number;
  }
>("migrationRehearsal:replaceReferenceTables");

const importPvsPatients = makeFunctionReference<
  "mutation",
  {
    patients: PvsPatientImportRow[];
    practiceId: string;
  },
  {
    insertedPatients: number;
    unchangedPatients: number;
    updatedPatients: number;
  }
>("migrationRehearsal:importPvsPatients");

const deletePristineMigrationTablePage = makeFunctionReference<
  "mutation",
  {
    activeRuleSetId?: string;
    limit: number;
    practiceId?: string;
    tableName: PristineResetTableName;
  },
  {
    deletedRows: number;
  }
>("migrationRehearsal:deletePristineMigrationTablePage");

interface CliOptions {
  adminKeyEnvName: string;
  apply: boolean;
  checkWorkOS: boolean;
  command: "patients" | "plan" | "references" | "reset";
  convexUrl: string;
  deployment: string;
  expectedPracticeSlug?: string;
  manifestPath: string;
  operatorWorkOSUserId?: string;
  practiceId: string;
  skipTargetCheck: boolean;
  websiteUrl?: string;
  workOSOrganizationId: string;
}

type PristineResetTableName =
  | "appointmentRestoreSnapshots"
  | "appointments"
  | "appointmentSeries"
  | "appointmentTypeFolders"
  | "appointmentTypes"
  | "baseSchedules"
  | "blockedSlots"
  | "bookingCalendarReachedSteps"
  | "bookingExistingDoctorSelectionSteps"
  | "bookingIdentities"
  | "bookingIdentityPatientAssociations"
  | "bookingLocationSteps"
  | "bookingMedicalHistoryEntries"
  | "bookingNewDataSharingContactRows"
  | "bookingNewDataSharingSteps"
  | "bookingNewGkvDetailSteps"
  | "bookingNewInsuranceTypeSteps"
  | "bookingNewPkvConsentSteps"
  | "bookingNewPkvDetailSteps"
  | "bookingPatientStatusSteps"
  | "bookingPersonalDataSteps"
  | "bookingPrivacySteps"
  | "legacyUnmatchedFutureBookingHolds"
  | "locations"
  | "mfas"
  | "onlineAccountBlocks"
  | "organizationMembersPatient"
  | "patients"
  | "phoneBookingIdentities"
  | "practicePhoneNumbers"
  | "practitionerAssociations"
  | "practitioners"
  | "stalePractices"
  | "staleRuleConditions"
  | "staleRuleSets"
  | "vacations";

interface ResetManifest {
  applied: boolean;
  generatedAt: string;
  inputs: {
    convexUrl: string;
    deployment: string;
    expectedPracticeSlug?: string;
    operatorWorkOSUserId?: string;
    practiceId: string;
    websiteUrl?: string;
    workOSOrganizationId: string;
  };
  preflight: {
    failures: string[];
    warnings: string[];
  };
  reset?: {
    tables: {
      deletedRows: number;
      tableName: PristineResetTableName;
    }[];
    totalDeletedRows: number;
  };
  target: ProductionTargetDescription;
}

interface PvsPatientImportRow {
  firstName: string;
  lastName: string;
  patientId: number;
}

interface ProductionTargetDescription {
  authBypassEnabled: boolean;
  migrationRehearsalEnabled: boolean;
  migrationOperatorAllowlistConfigured: boolean;
  practice: {
    _id: string;
    currentActiveRuleSetId?: string;
    name: string;
    slug?: string;
    workOSOrganizationId?: string;
  } | null;
  ruleSet: {
    _id: string;
    description: string;
    saved: boolean;
    version: number;
  } | null;
  workOSEnvironment: {
    hasApiKey: boolean;
    hasClientId: boolean;
    hasWebhookSecret: boolean;
  };
}

interface SourceArtifact {
  exists: boolean;
  path: string;
  rows?: number;
  sizeBytes?: number;
}

interface WorkOSOrganizationCheck {
  id?: string;
  ok: boolean;
  status?: number;
}

interface PlanManifest {
  generatedAt: string;
  inputs: {
    convexUrl: string;
    deployment: string;
    expectedPracticeSlug?: string;
    practiceId: string;
    websiteUrl?: string;
    workOSOrganizationId: string;
  };
  preflight: {
    failures: string[];
    warnings: string[];
  };
  sourceArtifacts: Record<string, SourceArtifact>;
  target: ProductionTargetDescription;
  workOSOrganization?: WorkOSOrganizationCheck;
}

interface ReferencesManifest {
  applied: boolean;
  generatedAt: string;
  inputs: {
    convexUrl: string;
    deployment: string;
    expectedPracticeSlug?: string;
    operatorWorkOSUserId?: string;
    practiceId: string;
    websiteUrl?: string;
    workOSOrganizationId: string;
  };
  preflight: {
    failures: string[];
    warnings: string[];
  };
  references: ReferenceImportRows;
  result?: {
    appointmentTypes: number;
    locations: number;
    practitioners: number;
  };
  target: ProductionTargetDescription;
}

interface PatientsManifest {
  applied: boolean;
  generatedAt: string;
  inputs: {
    convexUrl: string;
    deployment: string;
    expectedPracticeSlug?: string;
    operatorWorkOSUserId?: string;
    practiceId: string;
    websiteUrl?: string;
    workOSOrganizationId: string;
  };
  patients: {
    batches?: {
      insertedPatients: number;
      unchangedPatients: number;
      updatedPatients: number;
    };
    duplicates: number[];
    invalidRows: string[];
    rows: number;
  };
  preflight: {
    failures: string[];
    warnings: string[];
  };
  target: ProductionTargetDescription;
}

const pristineResetTableOrder: PristineResetTableName[] = [
  "appointmentRestoreSnapshots",
  "appointmentSeries",
  "appointments",
  "bookingNewDataSharingContactRows",
  "bookingMedicalHistoryEntries",
  "bookingCalendarReachedSteps",
  "bookingExistingDoctorSelectionSteps",
  "bookingLocationSteps",
  "bookingNewDataSharingSteps",
  "bookingNewGkvDetailSteps",
  "bookingNewInsuranceTypeSteps",
  "bookingNewPkvConsentSteps",
  "bookingNewPkvDetailSteps",
  "bookingPatientStatusSteps",
  "bookingPersonalDataSteps",
  "bookingPrivacySteps",
  "bookingIdentityPatientAssociations",
  "practitionerAssociations",
  "legacyUnmatchedFutureBookingHolds",
  "onlineAccountBlocks",
  "bookingIdentities",
  "organizationMembersPatient",
  "patients",
  "blockedSlots",
  "vacations",
  "baseSchedules",
  "appointmentTypes",
  "appointmentTypeFolders",
  "locations",
  "mfas",
  "practitioners",
  "phoneBookingIdentities",
  "practicePhoneNumbers",
  "staleRuleConditions",
  "staleRuleSets",
  "stalePractices",
];

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  node scripts/migration/run-production-rehearsal.mts plan \\",
      "    --deployment <convex-deployment> \\",
      "    --convex-url https://<deployment>.convex.cloud \\",
      "    --workos-organization-id org_... \\",
      "    --practice-id <convex-practice-id>",
      "",
      "  node scripts/migration/run-production-rehearsal.mts references \\",
      "    --deployment <convex-deployment> \\",
      "    --convex-url https://<deployment>.convex.cloud \\",
      "    --workos-organization-id org_... \\",
      "    --practice-id <convex-practice-id> \\",
      "    --operator-workos-user-id user_...",
      "",
      "  node scripts/migration/run-production-rehearsal.mts patients \\",
      "    --deployment <convex-deployment> \\",
      "    --convex-url https://<deployment>.convex.cloud \\",
      "    --workos-organization-id org_... \\",
      "    --practice-id <convex-practice-id> \\",
      "    --operator-workos-user-id user_...",
      "",
      "  node scripts/migration/run-production-rehearsal.mts reset \\",
      "    --deployment <convex-deployment> \\",
      "    --convex-url https://<deployment>.convex.cloud \\",
      "    --workos-organization-id org_... \\",
      "    --practice-id <convex-practice-id> \\",
      "    --operator-workos-user-id user_... \\",
      "    --apply",
      "",
      "Optional:",
      "  --apply",
      "  --skip-target-check (references dry-run only)",
      "  --website-url https://example.com",
      "  --expected-practice-slug <slug>",
      `  --admin-key-env ${defaultAdminKeyEnvName}`,
      "  --manifest-path .cache/migration/reports/production-rehearsal-plan.json",
      "  --check-workos",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const normalizedArgv = argv[1] === "--" ? [argv[0], ...argv.slice(2)] : argv;
  const [command, ...tokens] = normalizedArgv;
  if (
    command !== "plan" &&
    command !== "references" &&
    command !== "patients" &&
    command !== "reset"
  ) {
    return usage();
  }

  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !token.startsWith("--")) {
      return usage();
    }
    if (token === "--check-workos") {
      flags.add(token);
      continue;
    }
    if (token === "--apply") {
      flags.add(token);
      continue;
    }
    if (token === "--skip-target-check") {
      flags.add(token);
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return usage();
    }
    values.set(token, value);
    index += 1;
  }

  const deployment = requiredValue(values, "--deployment");
  const convexUrl = requiredValue(values, "--convex-url");
  const workOSOrganizationId = requiredValue(
    values,
    "--workos-organization-id",
  );
  const practiceId = requiredValue(values, "--practice-id");

  return {
    adminKeyEnvName: values.get("--admin-key-env") ?? defaultAdminKeyEnvName,
    apply: flags.has("--apply"),
    checkWorkOS: flags.has("--check-workos"),
    command,
    convexUrl,
    deployment,
    expectedPracticeSlug: values.get("--expected-practice-slug"),
    manifestPath: resolveWorkspacePath(
      values.get("--manifest-path") ??
        (command === "references"
          ? defaultReferencesManifestPath
          : command === "patients"
            ? defaultPatientsManifestPath
            : command === "reset"
              ? defaultResetManifestPath
              : defaultManifestPath),
    ),
    operatorWorkOSUserId: values.get("--operator-workos-user-id"),
    practiceId,
    skipTargetCheck: flags.has("--skip-target-check"),
    websiteUrl: values.get("--website-url"),
    workOSOrganizationId,
  };
}

function requiredValue(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined || value.trim().length === 0) {
    return usage();
  }
  return value;
}

function resolveWorkspacePath(path: string): string {
  return path.startsWith("/") ? path : join(workspaceRoot, path);
}

function isLocalUrl(value: string): boolean {
  return (
    value.includes("localhost") ||
    value.includes("127.0.0.1") ||
    value.includes("[::1]")
  );
}

function parseHttpsHost(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }
    return url.hostname;
  } catch {
    return null;
  }
}

function isBareConvexDeploymentName(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function validateDeploymentUrlBinding(options: CliOptions): string[] {
  const failures: string[] = [];
  const host = parseHttpsHost(options.convexUrl);
  if (host === null) {
    return ["Convex URL must be a valid HTTPS URL."];
  }
  if (!isBareConvexDeploymentName(options.deployment)) {
    failures.push(
      "--deployment must be the concrete Convex deployment name, not a local/prod/dev alias.",
    );
    return failures;
  }
  const exactHost = `${options.deployment}.convex.cloud`;
  const regionalHostSuffix = ".convex.cloud";
  if (
    host !== exactHost &&
    !(
      host.startsWith(`${options.deployment}.`) &&
      host.endsWith(regionalHostSuffix)
    )
  ) {
    failures.push(
      `Convex URL host ${host} does not match deployment ${options.deployment}.`,
    );
  }
  return failures;
}

function validateStaticInputs(options: CliOptions): string[] {
  const failures: string[] = [];
  if (
    options.deployment.startsWith("local:") ||
    options.deployment === "local"
  ) {
    failures.push(
      "Deployment must be an explicit non-local Convex deployment.",
    );
  }
  if (
    !options.convexUrl.startsWith("https://") ||
    isLocalUrl(options.convexUrl)
  ) {
    failures.push("Convex URL must be an HTTPS non-local URL.");
  }
  failures.push(...validateDeploymentUrlBinding(options));
  if (options.websiteUrl !== undefined && isLocalUrl(options.websiteUrl)) {
    failures.push("Website URL must be non-local when provided.");
  }
  if (!options.workOSOrganizationId.startsWith("org_")) {
    failures.push("WorkOS organization ID must look like org_...");
  }
  return failures;
}

function readAdminKey(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing ${envName}; set it to a Convex admin/deploy key.`);
  }
  return value;
}

function createConvexClient(options: CliOptions): ConvexHttpClient {
  const staticFailures = validateStaticInputs(options);
  if (staticFailures.length > 0) {
    throw new Error(staticFailures.join("\n"));
  }
  const client = new ConvexHttpClient(options.convexUrl);
  client.setAdminAuth(readAdminKey(options.adminKeyEnvName), {
    email: "migration-operator@example.invalid",
    issuer: "praxisplaner-production-rehearsal",
    subject: options.operatorWorkOSUserId ?? "migration-operator",
  });
  return client;
}

function countTextRows(path: string): number {
  const text = readFileSync(path, "utf8").trim();
  if (text.length === 0) {
    return 0;
  }
  return text.split("\n").length;
}

function inspectArtifact(path: string, hasHeader: boolean): SourceArtifact {
  if (!existsSync(path)) {
    return { exists: false, path };
  }
  const sizeBytes = statSync(path).size;
  const rows = Math.max(0, countTextRows(path) - (hasHeader ? 1 : 0));
  return {
    exists: true,
    path,
    rows,
    sizeBytes,
  };
}

function inspectSourceArtifacts(): Record<string, SourceArtifact> {
  return {
    bookingIdentityPatientAssociations: inspectArtifact(
      join(reportRoot, "booking-identity-patient-associations.source.jsonl"),
      false,
    ),
    bookingIdentities: inspectArtifact(
      join(reportRoot, "booking-identities.source.jsonl"),
      false,
    ),
    legacyBookingBlocks: inspectArtifact(
      join(reportRoot, "legacy-booking-blocks.source.jsonl"),
      false,
    ),
    legacyBookingStepReplay: inspectArtifact(
      join(reportRoot, "legacy-booking-step-replay.source.jsonl"),
      false,
    ),
    legacyUsers: inspectArtifact(
      join(reportRoot, "legacy-users.source.jsonl"),
      false,
    ),
    oldAppointments: inspectArtifact(
      join(sourceRoot, "old-appointments.csv"),
      true,
    ),
    patients: inspectArtifact(join(sourceRoot, "patients.csv"), true),
    pvsPatientPractitionerAssociations: inspectArtifact(
      join(reportRoot, "pvs-patient-practitioner-associations.source.jsonl"),
      false,
    ),
    unmatchedFutureBookingHolds: inspectArtifact(
      join(reportRoot, "legacy-unmatched-future-booking-holds.source.jsonl"),
      false,
    ),
  };
}

function validateTarget(
  options: CliOptions,
  target: ProductionTargetDescription,
  artifacts: Record<string, SourceArtifact>,
): { failures: string[]; warnings: string[] } {
  const failures = validateStaticInputs(options);
  const warnings: string[] = [];

  if (target.practice === null) {
    failures.push(`Practice ${options.practiceId} was not found.`);
  } else {
    if (target.practice._id !== options.practiceId) {
      failures.push("Convex returned a different practice ID than requested.");
    }
    if (target.practice.currentActiveRuleSetId === undefined) {
      failures.push("Target practice has no active rule set.");
    }
    if (target.practice.workOSOrganizationId !== options.workOSOrganizationId) {
      failures.push(
        "Target practice workOSOrganizationId does not match --workos-organization-id.",
      );
    }
    if (
      options.expectedPracticeSlug !== undefined &&
      target.practice.slug !== options.expectedPracticeSlug
    ) {
      failures.push(
        "Target practice slug does not match --expected-practice-slug.",
      );
    }
  }
  if (target.ruleSet === null) {
    failures.push("Target active rule set was not found.");
  } else if (!target.ruleSet.saved) {
    warnings.push("Target active rule set is not saved.");
  }
  if (target.authBypassEnabled) {
    failures.push("AUTH_BYPASS_ENABLED is true on the target deployment.");
  }
  if (!target.migrationRehearsalEnabled) {
    warnings.push(
      "MIGRATION_REHEARSAL_ENABLED is false; write phases will be blocked until it is enabled.",
    );
  }
  if (!target.migrationOperatorAllowlistConfigured) {
    failures.push(
      "MIGRATION_OPERATOR_WORKOS_USER_IDS is missing or empty on the target Convex deployment.",
    );
  }
  if (!target.workOSEnvironment.hasApiKey) {
    failures.push("WORKOS_API_KEY is missing on the target Convex deployment.");
  }
  if (!target.workOSEnvironment.hasClientId) {
    failures.push(
      "WORKOS_CLIENT_ID is missing on the target Convex deployment.",
    );
  }
  if (!target.workOSEnvironment.hasWebhookSecret) {
    failures.push(
      "WORKOS_WEBHOOK_SECRET is missing on the target Convex deployment.",
    );
  }

  for (const [name, artifact] of Object.entries(artifacts)) {
    if (!artifact.exists) {
      warnings.push(`Source artifact is missing: ${name}`);
    }
  }

  return { failures, warnings };
}

function validateReferencesTarget(
  options: CliOptions,
  target: ProductionTargetDescription,
): { failures: string[]; warnings: string[] } {
  const preflight = options.skipTargetCheck
    ? {
        failures: validateStaticInputs(options),
        warnings: [
          "Skipped Convex target check; use the documented pinned CLI inline query before applying.",
        ],
      }
    : validateTarget(options, target, {});
  if (!existsSync(join(sourceRoot, "old-appointments.csv"))) {
    preflight.failures.push(
      "Missing .cache/migration/source/old-appointments.csv.",
    );
  }
  if (options.apply) {
    if (options.skipTargetCheck) {
      preflight.failures.push(
        "--skip-target-check cannot be used with --apply.",
      );
    }
    if (options.operatorWorkOSUserId === undefined) {
      preflight.failures.push(
        "--operator-workos-user-id is required when applying references.",
      );
    }
    if (!target.migrationRehearsalEnabled) {
      preflight.failures.push(
        "MIGRATION_REHEARSAL_ENABLED must be true before applying references.",
      );
    }
  }
  return preflight;
}

function validatePatientsTarget(
  options: CliOptions,
  target: ProductionTargetDescription,
): { failures: string[]; warnings: string[] } {
  const preflight = options.skipTargetCheck
    ? {
        failures: validateStaticInputs(options),
        warnings: [
          "Skipped Convex target check; use the documented pinned CLI inline query before applying.",
        ],
      }
    : validateTarget(options, target, {});
  if (!existsSync(join(sourceRoot, "patients.csv"))) {
    preflight.failures.push("Missing .cache/migration/source/patients.csv.");
  }
  if (options.apply) {
    if (options.skipTargetCheck) {
      preflight.failures.push(
        "--skip-target-check cannot be used with --apply.",
      );
    }
    if (options.operatorWorkOSUserId === undefined) {
      preflight.failures.push(
        "--operator-workos-user-id is required when applying patients.",
      );
    }
    if (!target.migrationRehearsalEnabled) {
      preflight.failures.push(
        "MIGRATION_REHEARSAL_ENABLED must be true before applying patients.",
      );
    }
  }
  return preflight;
}

function validateResetTarget(
  options: CliOptions,
  target: ProductionTargetDescription,
): { failures: string[]; warnings: string[] } {
  const preflight = options.skipTargetCheck
    ? {
        failures: validateStaticInputs(options),
        warnings: [
          "Skipped Convex target check; use the documented pinned CLI inline query before applying.",
        ],
      }
    : validateTarget(options, target, {});
  if (options.apply) {
    if (options.skipTargetCheck) {
      preflight.failures.push(
        "--skip-target-check cannot be used with --apply.",
      );
    }
    if (options.operatorWorkOSUserId === undefined) {
      preflight.failures.push(
        "--operator-workos-user-id is required when applying reset.",
      );
    }
    if (!target.migrationRehearsalEnabled) {
      preflight.failures.push(
        "MIGRATION_REHEARSAL_ENABLED must be true before applying reset.",
      );
    }
  }
  return preflight;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
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
  if (headers === undefined) {
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

function buildPvsPatientRows(csvText: string): {
  duplicates: number[];
  invalidRows: string[];
  rows: PvsPatientImportRow[];
} {
  const seenPatientIds = new Set<number>();
  const duplicatePatientIds = new Set<number>();
  const invalidRows: string[] = [];
  const rows: PvsPatientImportRow[] = [];

  for (const [index, row] of parseCsv(csvText).entries()) {
    const csvLine = index + 2;
    const rawPatientId = row["ID"]?.trim() ?? "";
    const firstName = row["Vorname"]?.trim() ?? "";
    const lastName = row["Nachname"]?.trim() ?? "";
    const patientId = Number(rawPatientId);

    if (
      rawPatientId.length === 0 ||
      !Number.isInteger(patientId) ||
      patientId <= 0
    ) {
      invalidRows.push(`line ${csvLine}: invalid ID`);
      continue;
    }
    if (firstName.length === 0 || lastName.length === 0) {
      invalidRows.push(`line ${csvLine}: blank first or last name`);
      continue;
    }
    if (seenPatientIds.has(patientId)) {
      duplicatePatientIds.add(patientId);
      continue;
    }

    seenPatientIds.add(patientId);
    rows.push({ firstName, lastName, patientId });
  }

  return {
    duplicates: [...duplicatePatientIds].toSorted(
      (left, right) => left - right,
    ),
    invalidRows,
    rows,
  };
}

function readWorkOSApiHostname(): string {
  const apiHostname = process.env["WORKOS_API_HOSTNAME"]?.trim();
  if (apiHostname === undefined || apiHostname.length === 0) {
    return "api.workos.com";
  }
  if (
    apiHostname.includes("://") ||
    apiHostname.includes("/") ||
    apiHostname.endsWith(".authkit.app")
  ) {
    throw new Error(
      "WORKOS_API_HOSTNAME must be a WorkOS Authentication API hostname, not an AuthKit app URL.",
    );
  }
  return apiHostname;
}

function readWorkOSApiKey(): string {
  const apiKey = process.env["WORKOS_API_KEY"];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("Missing WORKOS_API_KEY for --check-workos.");
  }
  return apiKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function checkWorkOSOrganization(
  organizationId: string,
): Promise<WorkOSOrganizationCheck> {
  const response = await fetch(
    `https://${readWorkOSApiHostname()}/organizations/${encodeURIComponent(
      organizationId,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${readWorkOSApiKey()}`,
        "Content-Type": "application/json",
      },
      method: "GET",
    },
  );
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  const payload: unknown = await response.json();
  const organization =
    isRecord(payload) && isRecord(payload["organization"])
      ? payload["organization"]
      : payload;
  return {
    ok: true,
    status: response.status,
    ...(isRecord(organization) && typeof organization["id"] === "string"
      ? { id: organization["id"] }
      : {}),
  };
}

function writeJson(path: string, value: PlanManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeReferencesJson(path: string, value: ReferencesManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writePatientsJson(path: string, value: PatientsManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeResetJson(path: string, value: ResetManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runPlan(options: CliOptions): Promise<void> {
  const client = createConvexClient(options);
  const [target, workOSOrganization] = await Promise.all([
    client.query(describeTarget, { practiceId: options.practiceId }),
    options.checkWorkOS
      ? checkWorkOSOrganization(options.workOSOrganizationId)
      : Promise.resolve(undefined),
  ]);
  const sourceArtifacts = inspectSourceArtifacts();
  const preflight = validateTarget(options, target, sourceArtifacts);
  if (
    workOSOrganization !== undefined &&
    (!workOSOrganization.ok ||
      workOSOrganization.id !== options.workOSOrganizationId)
  ) {
    preflight.failures.push(
      "WorkOS organization lookup did not confirm the target organization.",
    );
  }

  const manifest: PlanManifest = {
    generatedAt: new Date().toISOString(),
    inputs: {
      convexUrl: options.convexUrl,
      deployment: options.deployment,
      practiceId: options.practiceId,
      workOSOrganizationId: options.workOSOrganizationId,
      ...(options.expectedPracticeSlug === undefined
        ? {}
        : { expectedPracticeSlug: options.expectedPracticeSlug }),
      ...(options.websiteUrl === undefined
        ? {}
        : { websiteUrl: options.websiteUrl }),
    },
    preflight,
    sourceArtifacts,
    target,
    ...(workOSOrganization === undefined ? {} : { workOSOrganization }),
  };

  writeJson(options.manifestPath, manifest);

  console.log(`Wrote production rehearsal plan: ${options.manifestPath}`);
  console.log(
    `Preflight failures: ${preflight.failures.length}; warnings: ${preflight.warnings.length}`,
  );
  if (preflight.failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runReset(options: CliOptions): Promise<void> {
  const client = options.skipTargetCheck ? null : createConvexClient(options);
  const target = options.skipTargetCheck
    ? createUncheckedTarget(options)
    : await client.query(describeTarget, {
        practiceId: options.practiceId,
      });
  const preflight = validateResetTarget(options, target);
  const tableResults: {
    deletedRows: number;
    tableName: PristineResetTableName;
  }[] = [];

  if (options.apply && preflight.failures.length === 0) {
    if (client === null) {
      throw new Error("Unexpected missing Convex client for apply.");
    }
    const activeRuleSetId = target.practice?.currentActiveRuleSetId;
    for (const tableName of pristineResetTableOrder) {
      let tableDeletedRows = 0;
      while (true) {
        const result = await client.mutation(deletePristineMigrationTablePage, {
          ...(activeRuleSetId === undefined ? {} : { activeRuleSetId }),
          limit: 200,
          practiceId: options.practiceId,
          tableName,
        });
        tableDeletedRows += result.deletedRows;
        if (result.deletedRows === 0) {
          break;
        }
      }
      tableResults.push({ deletedRows: tableDeletedRows, tableName });
      console.log(`Reset ${tableName}: deleted ${tableDeletedRows}`);
    }
  }

  const totalDeletedRows = tableResults.reduce(
    (total, table) => total + table.deletedRows,
    0,
  );
  const manifest: ResetManifest = {
    applied: options.apply && preflight.failures.length === 0,
    generatedAt: new Date().toISOString(),
    inputs: {
      convexUrl: options.convexUrl,
      deployment: options.deployment,
      practiceId: options.practiceId,
      workOSOrganizationId: options.workOSOrganizationId,
      ...(options.expectedPracticeSlug === undefined
        ? {}
        : { expectedPracticeSlug: options.expectedPracticeSlug }),
      ...(options.operatorWorkOSUserId === undefined
        ? {}
        : { operatorWorkOSUserId: options.operatorWorkOSUserId }),
      ...(options.websiteUrl === undefined
        ? {}
        : { websiteUrl: options.websiteUrl }),
    },
    preflight,
    ...(tableResults.length === 0
      ? {}
      : { reset: { tables: tableResults, totalDeletedRows } }),
    target,
  };

  writeResetJson(options.manifestPath, manifest);

  console.log(`Wrote production reset manifest: ${options.manifestPath}`);
  console.log(
    `Preflight failures: ${preflight.failures.length}; warnings: ${preflight.warnings.length}; applied: ${manifest.applied}; deleted: ${totalDeletedRows}`,
  );
  if (preflight.failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runReferences(options: CliOptions): Promise<void> {
  const client = options.skipTargetCheck ? null : createConvexClient(options);
  const target = options.skipTargetCheck
    ? createUncheckedTarget(options)
    : await client.query(describeTarget, {
        practiceId: options.practiceId,
      });
  const preflight = validateReferencesTarget(options, target);
  const references = existsSync(join(sourceRoot, "old-appointments.csv"))
    ? buildReferenceImportRows(
        readFileSync(join(sourceRoot, "old-appointments.csv"), "utf8"),
      )
    : {
        appointmentTypes: [],
        locations: [],
        practitioners: [],
        stats: {
          durationFallbackAppointmentTypes: 0,
          durationFallbackRows: 0,
          sourceAppointments: 0,
        },
      };

  let result:
    | {
        appointmentTypes: number;
        locations: number;
        practitioners: number;
      }
    | undefined;

  if (options.apply && preflight.failures.length === 0) {
    const ruleSetId = target.practice?.currentActiveRuleSetId;
    if (ruleSetId === undefined) {
      preflight.failures.push("Target practice has no active rule set.");
    } else {
      if (client === null) {
        throw new Error("Unexpected missing Convex client for apply.");
      }
      result = await client.mutation(replaceReferenceTables, {
        appointmentTypes: references.appointmentTypes,
        locations: references.locations,
        practiceId: options.practiceId,
        practitioners: references.practitioners,
        ruleSetId,
      });
    }
  }

  const manifest: ReferencesManifest = {
    applied: result !== undefined,
    generatedAt: new Date().toISOString(),
    inputs: {
      convexUrl: options.convexUrl,
      deployment: options.deployment,
      practiceId: options.practiceId,
      workOSOrganizationId: options.workOSOrganizationId,
      ...(options.expectedPracticeSlug === undefined
        ? {}
        : { expectedPracticeSlug: options.expectedPracticeSlug }),
      ...(options.operatorWorkOSUserId === undefined
        ? {}
        : { operatorWorkOSUserId: options.operatorWorkOSUserId }),
      ...(options.websiteUrl === undefined
        ? {}
        : { websiteUrl: options.websiteUrl }),
    },
    preflight,
    references,
    ...(result === undefined ? {} : { result }),
    target,
  };

  writeReferencesJson(options.manifestPath, manifest);

  console.log(`Wrote production references manifest: ${options.manifestPath}`);
  console.log(
    `Preflight failures: ${preflight.failures.length}; warnings: ${preflight.warnings.length}; applied: ${result !== undefined}`,
  );
  if (preflight.failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runPatients(options: CliOptions): Promise<void> {
  const client = options.skipTargetCheck ? null : createConvexClient(options);
  const target = options.skipTargetCheck
    ? createUncheckedTarget(options)
    : await client.query(describeTarget, {
        practiceId: options.practiceId,
      });
  const preflight = validatePatientsTarget(options, target);
  const patientSourcePath = join(sourceRoot, "patients.csv");
  const shapedPatients = existsSync(patientSourcePath)
    ? buildPvsPatientRows(readFileSync(patientSourcePath, "utf8"))
    : { duplicates: [], invalidRows: [], rows: [] };

  if (shapedPatients.duplicates.length > 0) {
    preflight.failures.push(
      `patients.csv contains duplicate IDs: ${shapedPatients.duplicates
        .slice(0, 20)
        .join(", ")}`,
    );
  }
  if (shapedPatients.invalidRows.length > 0) {
    preflight.failures.push(
      `patients.csv contains invalid rows: ${shapedPatients.invalidRows
        .slice(0, 20)
        .join("; ")}`,
    );
  }

  let batchResult:
    | {
        insertedPatients: number;
        unchangedPatients: number;
        updatedPatients: number;
      }
    | undefined;

  if (options.apply && preflight.failures.length === 0) {
    if (client === null) {
      throw new Error("Unexpected missing Convex client for apply.");
    }
    const aggregate = {
      insertedPatients: 0,
      unchangedPatients: 0,
      updatedPatients: 0,
    };
    const batchSize = 250;
    for (
      let startIndex = 0;
      startIndex < shapedPatients.rows.length;
      startIndex += batchSize
    ) {
      const result = await client.mutation(importPvsPatients, {
        patients: shapedPatients.rows.slice(startIndex, startIndex + batchSize),
        practiceId: options.practiceId,
      });
      aggregate.insertedPatients += result.insertedPatients;
      aggregate.unchangedPatients += result.unchangedPatients;
      aggregate.updatedPatients += result.updatedPatients;
    }
    batchResult = aggregate;
  }

  const manifest: PatientsManifest = {
    applied: batchResult !== undefined,
    generatedAt: new Date().toISOString(),
    inputs: {
      convexUrl: options.convexUrl,
      deployment: options.deployment,
      practiceId: options.practiceId,
      workOSOrganizationId: options.workOSOrganizationId,
      ...(options.expectedPracticeSlug === undefined
        ? {}
        : { expectedPracticeSlug: options.expectedPracticeSlug }),
      ...(options.operatorWorkOSUserId === undefined
        ? {}
        : { operatorWorkOSUserId: options.operatorWorkOSUserId }),
      ...(options.websiteUrl === undefined
        ? {}
        : { websiteUrl: options.websiteUrl }),
    },
    patients: {
      ...(batchResult === undefined ? {} : { batches: batchResult }),
      duplicates: shapedPatients.duplicates,
      invalidRows: shapedPatients.invalidRows,
      rows: shapedPatients.rows.length,
    },
    preflight,
    target,
  };

  writePatientsJson(options.manifestPath, manifest);

  console.log(`Wrote production patients manifest: ${options.manifestPath}`);
  console.log(
    `Preflight failures: ${preflight.failures.length}; warnings: ${preflight.warnings.length}; rows: ${shapedPatients.rows.length}; applied: ${batchResult !== undefined}`,
  );
  if (preflight.failures.length > 0) {
    process.exitCode = 1;
  }
}

function createUncheckedTarget(
  options: CliOptions,
): ProductionTargetDescription {
  return {
    authBypassEnabled: false,
    migrationOperatorAllowlistConfigured: false,
    migrationRehearsalEnabled: false,
    practice: {
      _id: options.practiceId,
      name: options.expectedPracticeSlug ?? "unchecked",
      ...(options.expectedPracticeSlug === undefined
        ? {}
        : { slug: options.expectedPracticeSlug }),
      workOSOrganizationId: options.workOSOrganizationId,
    },
    ruleSet: null,
    workOSEnvironment: {
      hasApiKey: false,
      hasClientId: false,
      hasWebhookSecret: false,
    },
  };
}

const options = parseArgs(process.argv.slice(2));
if (options.command === "plan") {
  await runPlan(options);
} else if (options.command === "reset") {
  await runReset(options);
} else if (options.command === "references") {
  await runReferences(options);
} else {
  await runPatients(options);
}

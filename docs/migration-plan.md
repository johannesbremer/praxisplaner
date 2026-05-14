# Migration plan from Praxistimer and legacy booking

This plan is intentionally data-shape focused. The local source artifacts are untracked and must stay out of commits:

- `patients.csv`
- `old-appointments.csv`
- `may26.zip`

## Current source inventory

Praxistimer exports:

- `patients.csv`: 11,956 rows, unique `ID` values. Columns: `ID`, `Titel`, `Vorname`, `Nachname`.
- `old-appointments.csv`: 247,183 appointment rows from `2018-07-12 12:45:00 +02:00` through `2027-05-13 15:10:00 +02:00`. Columns: `Beginn`, `Ende`, `Arzt`, `Raum`, `Terminart`, `Nachname`, `Vorname`, `Titel`, `ID`, `Termingrund`.
- Distinct Praxistimer appointment references seen in the CSV: 25 `Arzt` labels, 16 `Raum` labels, 93 appointment-type labels, 11,957 patient IDs.

Legacy online booking / TelefonKI backup:

- `may26.zip` contains a PocketBase-style SQLite backup with `data.db`, `auxiliary.db`, file storage, and generated type metadata.
- Important table counts in `data.db`: `users` 4,636, `personal` 4,250, `datenweitergabe` 984, `anamnese` 1,327, `anamnesetexte` 1,327, `pkv` 91, `termine` 28,073, `deletedTermine` 116, `oldTermine` 4,167, `phoneusers` 942, `baumdiagramm` 4,308, `pdfs` 2, `meds` 2, `docs` 8, `terminarten` 8.

## Target model

The existing ADRs are the correct migration boundary:

- PVS/Praxistimer patient IDs are canonical patient identities. They become `patients` rows with `recordType: "pvs"` and `patientId` populated.
- Online booking and TelefonKI identities are not automatically canonical patients. They become WorkOS users plus Convex `users` and booking-history data, then are correlated to PVS patients through explicit, reviewable match decisions.
- Appointments are append-only records. The historical Praxistimer export should import as initial immutable appointment facts, not as a replay of edits.

The current Convex schema requires appointments to reference `practiceId`, `locationLineageKey`, `appointmentTypeLineageKey`, and optionally `practitionerLineageKey` and `patientId`. That means raw CSV appointment rows cannot be imported directly into `appointments`; they must first be normalized through stable reference mapping tables. `Raum` must not be treated as a Convex practice location. The practice locations are the two sites, `Dissen a.T.W.` and `Bad Iburg`; `Raum` is a room/resource signal used to infer the site, while EKG/Labor/resource labels belong with operational practitioner/resource mapping.

## Import mechanics

Convex supports CLI imports from CSV, JSON, JSONL, and backup ZIPs with `npx convex import --table <tableName> <path>`. CSV is limited to strings and floating-point numbers, while JSONL can preserve nested object shape. Convex imports are atomic for table create/replace operations except `--append`. For this migration, use a generated Convex backup-style ZIP or trusted Convex mutations/actions for bulk writes. Do not use single-table JSONL for final imports into tables with `v.int64()` fields: a local rehearsal showed JSONL numeric timestamps fail schema validation for `createdAt` / `lastModified`, while ZIP imports with `generated_schema.jsonl` can encode those fields as Convex `int64`.

Nushell is a good shaping tool here because it parses CSV to structured tables, can query SQLite with `open data.db | query db "..."`, and can emit JSON/NDJSON-like output after transformations. Use it for exploration and deterministic exports, but put final irreversible import logic in versioned scripts with tests.

## Recommended migration architecture

Create a migration workspace that is ignored by git:

- `.cache/migration/source/`: local copies or extracted DBs.
- `.cache/migration/out/`: generated JSONL, reports, and match-review CSVs.
- `.cache/migration/reports/`: validation summaries.

Add tracked scripts only:

- `scripts/migration/extract-praxistimer.nu`
- `scripts/migration/extract-legacy-booking.nu`
- `scripts/migration/build-convex-import.ts`
- `scripts/migration/validate-migration.ts`
- `scripts/migration/build-local-rehearsal-import.mjs` as a small executable rehearsal of the backup-ZIP import mechanics.

Do not commit generated source data, generated JSONL containing patient data, SQLite extracts, or WorkOS import files.

## Phase 1: baseline reference data

1. Choose the target `practiceId` and current active `ruleSetId`.
2. Build review CSVs for Praxistimer references:
   - doctors/resources from `old-appointments.csv.Arzt` -> existing/new `practitioners.name`
   - rooms/resources from `old-appointments.csv.Raum` -> site mapping and optional resource metadata, not `locations`
   - appointment types from `old-appointments.csv.Terminart` -> existing/new `appointmentTypes.title`
3. Resolve aliases deliberately before importing appointments. The CSV has more raw labels than the current app probably wants long-term.
4. Insert or update the corresponding versioned reference rows in the active rule set and capture lineage keys for appointment import. The local rehearsal currently imports 93 appointment types, 25 practitioners/resources, and exactly two locations.

## Phase 2: PVS patients

Generate a backup-style `patients` ZIP table from `patients.csv`:

- `patientId`: numeric `ID`
- `firstName`: `Vorname`
- `lastName`: `Nachname`
- `recordType`: `"pvs"`
- `practiceId`: target practice
- `searchFirstName` / `searchLastName`: use the same normalization as `convex/patientSearch.ts`
- `createdAt` / `lastModified`: stable import timestamp

Validation:

- unique `(practiceId, patientId)`
- no blank first/last names unless explicitly accepted
- every generated row satisfies the Convex `patients` validator

## Phase 3: Praxistimer appointments

Generate a backup-style `appointments` ZIP table from `old-appointments.csv` after reference resolution:

- `start` / `end`: convert `Beginn` / `Ende` to ISO strings preserving the original offset semantics.
- `title`: derive from patient display name and/or `Termingrund`, but keep appointment-type title in `appointmentTypeTitle`.
- `patientId`: Convex ID resolved from Praxistimer `ID` when a PVS patient exists.
- `appointmentTypeLineageKey`: resolved from `Terminart`.
- `practitionerLineageKey`: resolved from `Arzt` when the row represents a provider appointment.
- `locationLineageKey`: resolved from `Raum` to the site location. Use `Diss` / `Dissen` room tokens for `Dissen a.T.W.` and `Iburg` / `Ibu` room tokens for `Bad Iburg`.
- `practiceId`: target practice.
- `createdAt` / `lastModified`: stable import timestamp.

Validation:

- every row resolves required reference keys
- every non-empty Praxistimer patient `ID` resolves or appears in an exception report
- `start < end`; the local rehearsal found Praxistimer rows where `Beginn == Ende`, so the importer must infer duration from the resolved appointment type, and if that is unavailable, use a small explicit fallback duration and report every affected source row
- imported day/range counts match source counts after any documented exclusions

## Phase 4: legacy WorkOS users

The legacy `users` table has email, username, password hash, verification, and PocketBase IDs. Password hashes should not be migrated into Convex. WorkOS should own authentication.

Plan:

1. Export candidate WorkOS users from legacy `users` joined to latest `personal` data:
   - email
   - first name / last name
   - legacy PocketBase user ID as metadata
   - verified status as metadata if useful
2. Decide password strategy:
   - preferred: WorkOS invites or password reset flow
   - avoid attempting to preserve PocketBase password hashes unless WorkOS explicitly supports the exact hash import path
3. Create WorkOS users first.
4. Export `users.jsonl` for Convex only after WorkOS IDs are known:
   - `authId`: WorkOS user ID
   - `email`
   - optional `firstName`, `lastName`
   - `createdAt`
5. Keep a local ignored mapping file: legacy PocketBase user ID -> WorkOS user ID -> Convex user ID.

## Phase 5: legacy booking history

Map legacy tables to current booking concepts:

- `baumdiagramm`: booking decision state and selected branch. Map to `bookingSessions` and per-step tables only where the data is meaningful after migration.
- `personal`: patient personal data entered by a user. Map to existing/new personal-data step rows or preserve as an imported profile history table if the current step tables are too workflow-specific.
- `datenweitergabe`: data-sharing contacts. Map to data-sharing step tables.
- `anamnese` and `anamnesetexte`: map to `medicalHistory` fields.
- `pkv`: map to PKV detail step fields.
- `termine`: legacy online-booked appointments. Correlate to imported Praxistimer appointments by datetime, doctor, location, appointment type, and patient identity. Do not create duplicates without a conflict report.
- `deletedTermine`, `oldTermine`, `freedTermine`: import only if they support audit or booking UX; otherwise summarize in a retained migration report.
- `phoneusers`: TelefonKI identities and requested appointment metadata. Correlate to PVS patients with the same matching pipeline.
- `pdfs`, `meds`, and `storage/*`: evaluate separately for file-storage import and retention requirements.

If the existing booking step tables are too tied to active 30-minute sessions, add a new explicit `importedBookingRecords` or `legacyBookingProfiles` table rather than distorting active booking workflow tables.

## Phase 6: identity correlation

Use deterministic tiers and produce a manual review file for everything below exact confidence:

1. Exact Praxistimer ID: automatic.
2. Exact normalized first name + last name + date of birth: automatic if unique.
3. Exact phone + strong name similarity: review.
4. Appointment correlation: same datetime + practitioner + similar name: review.
5. Multiple candidates or missing DOB: manual review.

Persist match decisions as data, not code. The system should retain source identifiers:

- Praxistimer patient `ID`
- legacy PocketBase user ID
- legacy `phoneusers.id`
- legacy appointment IDs

## Phase 7: rehearsal and import order

Run the migration against a disposable Convex dev or preview deployment first.

Order:

1. Synthetic baseline / practice / active rule set
2. reference rows: practitioners, locations, appointment types
3. PVS patients
4. WorkOS users
5. Convex users and practice memberships
6. Praxistimer appointments
7. correlated legacy appointments and booking records
8. file storage, if retained

Use `npx convex import --replace` only on rehearsal deployments. For a final cutover, use a fresh target deployment or a tightly reviewed import set; avoid appending until duplicate detection reports are clean.

For local rehearsal, the current Convex CLI flow is:

```sh
pnpm exec convex deployment create local
pnpm exec convex deployment select local
pnpm exec convex env set WORKOS_CLIENT_ID client_local_migration_rehearsal
pnpm exec convex env set WORKOS_API_KEY sk_test_local_migration_rehearsal
pnpm exec convex env set WORKOS_WEBHOOK_SECRET whsec_local_migration_rehearsal
pnpm exec convex dev
```

Keep `pnpm exec convex dev` running in one terminal. In another terminal:

```sh
pnpm seed:preview
pnpm exec convex import --replace-all .cache/seed/preview.zip
node scripts/migration/build-local-rehearsal-import.mjs patients
pnpm exec convex import --replace .cache/migration/rehearsal/patients-rehearsal.zip
node scripts/migration/build-local-rehearsal-import.mjs appointments
pnpm exec convex import --replace .cache/migration/rehearsal/appointments-rehearsal.zip
```

## Example Nushell shaping commands

Inspect Praxistimer appointment dimensions:

```nu
let appts = (open old-appointments.csv)
{
  rows: ($appts | length)
  doctors: ($appts | get Arzt | uniq | length)
  rooms: ($appts | get Raum | uniq | length)
  types: ($appts | get Terminart | uniq | length)
}
```

Export distinct reference labels for review:

```nu
open old-appointments.csv
| select Arzt Raum Terminart
| uniq
| save .cache/migration/reports/praxistimer-reference-labels.csv
```

Query legacy SQLite:

```nu
open .cache/migration/source/data.db
| query db "select id, email, username, verified, created, updated from users"
| save .cache/migration/out/legacy-users.json
```

Shape PVS patients for a TypeScript importer:

```nu
open patients.csv
| rename patientId title firstName lastName
| update patientId { into int }
| save .cache/migration/out/pvs-patients.normalized.json
```

The TypeScript build step should convert normalized JSON into Convex-valid backup-ZIP table directories after resolving `practiceId`, setting int64 fields as strings plus `generated_schema.jsonl`, and computing search fields with the app's own patient-search helpers.

## Open decisions

- Final WorkOS password/invite flow.
- Whether to represent legacy booking history in existing booking step tables or a dedicated imported-history table.
- Appointment title policy for historical imports.
- Whether deleted/freed/old legacy appointment tables have legal/audit value.
- How much file-storage history to retain and whether PDFs/medication documents belong in Convex file storage.
- Final manual-review threshold for matching legacy online/TelefonKI identities to PVS patients.

## Documentation sources checked

- Convex Data Import: `https://docs.convex.dev/database/import-export/import`
- Nushell `from csv`: `https://www.nushell.sh/commands/docs/from_csv.html`
- Nushell `query db`: `https://www.nushell.sh/commands/docs/query_db.html`
- Nushell loading data guide: `https://www.nushell.sh/book/loading_data.html`

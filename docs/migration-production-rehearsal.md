# Production migration rehearsal

This runbook is for rehearsing the migration against the live pre-production
website stack: production Vercel, production Convex, and the real WorkOS
environment. The goal is to keep deterministic source shaping while using
explicit production safety gates.

## Non-negotiable safety rules

- For the one-time pre-production run, explicitly reset imported/migration-owned
  tables before importing. Preserve only the target practice, its active rule
  set, and non-patient owner/admin/staff organization members.
- Do not run `--replace-all` against the deployment. Use targeted reset helpers
  or single-table imports so the target practice and WorkOS owner stay intact.
- Do not enable `AUTH_BYPASS_ENABLED`.
- Do not use fake WorkOS credentials or `dev-admin` identities.
- Do not import Convex `users` before the corresponding WorkOS users exist.
- Do not rely on seed IDs for the target `practiceId` or active `ruleSetId`.
- Do not run the production rehearsal from `.env.local` unless the script has
  already proven the target deployment is non-local and explicit.

`MIGRATION_REHEARSAL_ENABLED=true` may still be used as a temporary feature flag
for migration-only Convex functions, but only on the intended production
rehearsal deployment and only during the import window. It is not an auth bypass.

## Reused source pipeline

These steps are deterministic source-shaping steps:

1. Convert and validate the Praxistimer source export.
2. Build PVS patient import rows from `patients.csv`.
3. Build reference labels from `old-appointments.csv`.
4. Correlate legacy appointments and booking identities.
5. Build legacy booking step replay rows and conflict reports.
6. Generate production appointment import ZIPs with explicit target IDs.
7. Run the same count and duplicate reports after import.

The production-specific wrapper supplies target IDs and WorkOS mappings to these
builders.

## Production target preflight

Before writing anything:

1. Confirm the Convex deployment URL is the intended production deployment.
2. Confirm `AUTH_BYPASS_ENABLED=false` in Convex.
3. Confirm WorkOS webhook delivery to
   `https://<convex-deployment>.convex.site/workos/webhook` for
   `user.created`, `user.updated`, `user.deleted`,
   `organization_membership.created`, `organization_membership.updated`, and
   `organization_membership.deleted`.
4. Confirm `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, and `WORKOS_WEBHOOK_SECRET`
   are set on the Convex deployment.
5. Confirm `MIGRATION_OPERATOR_WORKOS_USER_IDS` is set to the comma-separated
   WorkOS user IDs that are allowed to run migration-only functions.
6. Confirm the target practice exists, has the expected
   `workOSOrganizationId`, and has exactly one active rule set to import into.
7. Confirm the WorkOS organization has the expected owner/admin account that
   will run the migration-only mutations.
8. Generate and review a dry-run manifest containing row counts and target IDs.

The wrapper should require an explicit deployment name, an explicit WorkOS
organization ID, and an explicit practice slug or ID. Production defaults are
too dangerous here.

Current production target template:

- Convex deployment: `<prod-convex-deployment>`
- Site URL: `https://<prod-convex-deployment>.<region>.convex.site/`
- Convex cloud URL:
  `https://<prod-convex-deployment>.<region>.convex.cloud`
- Practice ID: `<prod-practice-id>`
- Active rule set ID: `<prod-active-rule-set-id>`
- Practice slug: `<prod-practice-slug>`
- WorkOS organization ID: `<prod-workos-organization-id>`

The worktree preview deployment is separate. Do not use `.env.local` as
production context.

Production was checked from the laptop with this read-only query:

```sh
pnpm exec convex run \
  --deployment "$PROD_CONVEX_DEPLOYMENT" \
  --inline-query 'const practices = await ctx.db.query("practices").collect(); return practices.map((practice) => ({ _id: practice._id, currentActiveRuleSetId: practice.currentActiveRuleSetId, name: practice.name, slug: practice.slug, workOSOrganizationId: practice.workOSOrganizationId }));'
```

It should return exactly one practice:

```json
[
  {
    "_id": "<prod-practice-id>",
    "currentActiveRuleSetId": "<prod-active-rule-set-id>",
    "name": "<prod-practice-name>",
    "slug": "<prod-practice-slug>",
    "workOSOrganizationId": "<prod-workos-organization-id>"
  }
]
```

## WorkOS account sequence

WorkOS owns authentication. Convex `users.authId` must be the WorkOS user ID,
not a legacy PocketBase ID.

1. Export candidate legacy online-booking users with email, first name, last
   name, legacy user ID, and verified state.
2. Deduplicate by normalized email. Emit conflicts for manual review instead of
   guessing.
3. Create or find WorkOS users before importing Convex user rows. Use legacy
   PocketBase user ID as `external_id` or metadata so repeated runs can be
   idempotent.
4. Run `auth:backfillUsers` or the equivalent user reconciliation until every
   WorkOS staff/admin/owner user that will receive an organization membership
   has a Convex `users` row.
5. Attach users to the target WorkOS organization with the intended role
   slugs. Staff users should get staff/admin/owner roles. Migrated booking users
   are organization members with role `patient`, mirrored in Convex
   `organizationMembers`.
6. Reconcile organization memberships after the Convex user backfill. This
   covers WorkOS `find` hits and delayed `user.created` webhooks where
   `organization_membership.created` can arrive first.
7. Only import Convex user rows for legacy online-booking users that must exist
   before login and are not covered by the webhook/backfill path.
8. Persist the ignored mapping file:
   `.cache/migration/reports/workos-user-map.source.jsonl`.

WorkOS currently supports creating users with email, optional password,
password hash fields, first/last name, email verification state, metadata, and
external ID. It also supports creating organization memberships with
`organization_id`, `user_id`, and `role_slug` or `role_slugs`. The preferred
production path remains password reset or invitation, unless we prove the
legacy password hash format exactly matches a WorkOS-supported import format.

Relevant WorkOS docs checked:

- https://workos.com/docs/reference/authkit/user#create-a-user
- https://workos.com/docs/reference/authkit/organization-membership#create-an-organization-membership
- https://workos.com/docs/reference/authkit/password-reset
- https://workos.com/docs/reference/authkit/invitation
- https://workos.com/docs/reference/organization#create-an-organization

## Import order

For a live pre-production rehearsal:

1. Deploy migration-capable code with `MIGRATION_REHEARSAL_ENABLED=false`.
2. Configure real WorkOS env vars and webhook.
3. Create or verify the WorkOS organization.
4. Create or verify the target practice linked by `workOSOrganizationId`.
5. Reset imported data while preserving the target practice, active rule set,
   and non-patient owner/admin/staff organization members.
6. Temporarily set `MIGRATION_REHEARSAL_ENABLED=true`.
7. Import or upsert reference rows into the active rule set.
8. Import PVS patients.
9. Import Praxistimer appointments. Imported appointments use `color: "blue"`.
10. Create/find WorkOS users in the current WorkOS workspace.
11. Backfill Convex users from WorkOS.
12. Create/find WorkOS organization memberships with role `patient`.
13. Reconcile Convex `organizationMembers` from WorkOS organization memberships.
14. Import booking identities, associations, account blocks, replay rows, and
    unmatched future booking holds.
15. Run count, duplicate, conflict, and browser smoke checks.
16. Set `MIGRATION_REHEARSAL_ENABLED=false`.

The production wrapper should stop after each phase and print the next exact
command. Automatic full-run mode can come later after the first production
rehearsal succeeds.

## Verification

Minimum checks before declaring the rehearsal usable on the website:

- WorkOS owner can log in and see the target practice.
- A migrated patient-facing user can complete WorkOS password reset or invite
  acceptance and log in.
- Practice staff cannot see unrelated users or foreign practice data.
- `patients` count matches the reviewed PVS import count.
- `appointments` count matches source rows minus documented exclusions.
- `bookingIdentities`, `bookingIdentityPatientAssociations`,
  `onlineAccountBlocks`, booking step rows, and unmatched future booking holds
  match the post-import count report.
- Conflict reports are retained under `.cache/migration/reports/` and contain no
  unreviewed rows that the import silently accepted.

## Wrapper commands

The production-only wrapper currently starts with a read-only `plan` command.
This command uses a Convex admin key. For the one-time laptop run, prefer the
explicit Convex CLI commands below because the laptop is already authenticated
to the target deployment.

Admin-key plan command:

```sh
CONVEX_ADMIN_KEY=... pnpm migration:production-plan -- \
  --deployment <convex-deployment> \
  --convex-url https://<deployment>.convex.cloud \
  --workos-organization-id org_... \
  --practice-id <convex-practice-id> \
  --expected-practice-slug <slug> \
  --website-url https://<website>
```

It writes `.cache/migration/reports/production-rehearsal-plan.json` and exits
non-zero if hard preflight checks fail. Add `--check-workos` when
`WORKOS_API_KEY` is available locally and the command should also verify the
WorkOS organization by API.

Public migration functions require both `MIGRATION_REHEARSAL_ENABLED=true` and
an authenticated WorkOS subject listed in `MIGRATION_OPERATOR_WORKOS_USER_IDS`.
The rehearsal flag alone is intentionally insufficient.

The first write-capable phase is `references`. It is a dry run unless `--apply`
is present:

```sh
CONVEX_ADMIN_KEY=... pnpm migration:production-references -- \
  --deployment "$CONVEX_DEPLOYMENT_NAME" \
  --convex-url "$CONVEX_URL" \
  --workos-organization-id "$WORKOS_ORGANIZATION_ID" \
  --practice-id "$PRACTICE_ID" \
  --operator-workos-user-id "$OPERATOR_WORKOS_USER_ID" \
  --expected-practice-slug "$PRACTICE_SLUG" \
  --website-url "$WEBSITE_URL"
```

It writes `.cache/migration/reports/production-rehearsal-references.json` with
the appointment types, locations, practitioners, and source counts that would be
sent to Convex.

Only after reviewing that manifest, enable the migration window and apply:

```sh
pnpm exec convex env set MIGRATION_REHEARSAL_ENABLED true

CONVEX_ADMIN_KEY=... pnpm migration:production-references -- \
  --deployment "$CONVEX_DEPLOYMENT_NAME" \
  --convex-url "$CONVEX_URL" \
  --workos-organization-id "$WORKOS_ORGANIZATION_ID" \
  --practice-id "$PRACTICE_ID" \
  --operator-workos-user-id "$OPERATOR_WORKOS_USER_ID" \
  --expected-practice-slug "$PRACTICE_SLUG" \
  --website-url "$WEBSITE_URL" \
  --apply

pnpm exec convex env set MIGRATION_REHEARSAL_ENABLED false
```

Later phases should follow the same shape: dry-run manifest first, then
operator-gated `--apply`.

The PVS patient phase is also dry-run-first. Copy `patients.csv` into
`.cache/migration/source/`, then generate the manifest:

```sh
CONVEX_ADMIN_KEY=... pnpm migration:production-patients -- \
  --deployment "$CONVEX_DEPLOYMENT_NAME" \
  --convex-url "$CONVEX_URL" \
  --workos-organization-id "$WORKOS_ORGANIZATION_ID" \
  --practice-id "$PRACTICE_ID" \
  --operator-workos-user-id "$OPERATOR_WORKOS_USER_ID" \
  --expected-practice-slug "$PRACTICE_SLUG" \
  --website-url "$WEBSITE_URL"
```

It writes `.cache/migration/reports/production-rehearsal-patients.json`.
Apply only after the manifest has no failures:

```sh
pnpm exec convex env set MIGRATION_REHEARSAL_ENABLED true

CONVEX_ADMIN_KEY=... pnpm migration:production-patients -- \
  --deployment "$CONVEX_DEPLOYMENT_NAME" \
  --convex-url "$CONVEX_URL" \
  --workos-organization-id "$WORKOS_ORGANIZATION_ID" \
  --practice-id "$PRACTICE_ID" \
  --operator-workos-user-id "$OPERATOR_WORKOS_USER_ID" \
  --expected-practice-slug "$PRACTICE_SLUG" \
  --website-url "$WEBSITE_URL" \
  --apply

pnpm exec convex env set MIGRATION_REHEARSAL_ENABLED false
```

## One-Time Laptop CLI Procedure

These commands are intentionally pinned to the explicit production deployment.
Do not rely on the selected deployment in `.env.local`.

1. Put the source export files in this worktree:

```sh
mkdir -p .cache/migration/source
# Required before the references dry run:
# .cache/migration/source/old-appointments.csv
```

2. Set shell constants:

```sh
export PROD_CONVEX_DEPLOYMENT=<prod-convex-deployment>
export PROD_SITE_URL=https://<prod-convex-deployment>.<region>.convex.site/
export PROD_CONVEX_URL=https://<prod-convex-deployment>.<region>.convex.cloud
export PROD_PRACTICE_ID=<prod-practice-id>
export PROD_RULE_SET_ID=<prod-active-rule-set-id>
export PROD_PRACTICE_SLUG=<prod-practice-slug>
export PROD_WORKOS_ORGANIZATION_ID=<prod-workos-organization-id>
export PROD_OPERATOR_WORKOS_USER_ID=user_...
```

3. Configure the operator allowlist while keeping writes disabled:

```sh
pnpm exec convex env set \
  --deployment "$PROD_CONVEX_DEPLOYMENT" \
  AUTH_BYPASS_ENABLED false

pnpm exec convex env set \
  --deployment "$PROD_CONVEX_DEPLOYMENT" \
  MIGRATION_REHEARSAL_ENABLED false

pnpm exec convex env set \
  --deployment "$PROD_CONVEX_DEPLOYMENT" \
  MIGRATION_OPERATOR_WORKOS_USER_IDS "$PROD_OPERATOR_WORKOS_USER_ID"
```

4. Run the reference dry run locally. This does not write to Convex:

```sh
pnpm migration:production-references -- \
  --deployment "$PROD_CONVEX_DEPLOYMENT" \
  --convex-url "$PROD_CONVEX_URL" \
  --workos-organization-id "$PROD_WORKOS_ORGANIZATION_ID" \
  --practice-id "$PROD_PRACTICE_ID" \
  --operator-workos-user-id "$PROD_OPERATOR_WORKOS_USER_ID" \
  --expected-practice-slug "$PROD_PRACTICE_SLUG" \
  --website-url "$PROD_SITE_URL" \
  --skip-target-check \
  --manifest-path .cache/migration/reports/production-rehearsal-references.json
```

Review `.cache/migration/reports/production-rehearsal-references.json` before
continuing. `--skip-target-check` is only acceptable here because the pinned
read-only CLI query above already verified the production practice. It is
blocked for `--apply`.

5. Apply references only during a short migration window:

```sh
pnpm exec convex env set \
  --deployment "$PROD_CONVEX_DEPLOYMENT" \
  MIGRATION_REHEARSAL_ENABLED true

pnpm exec convex run \
  --deployment "$PROD_CONVEX_DEPLOYMENT" \
  --push \
  --typecheck disable \
  --identity "{\"email\":\"migration-operator@example.invalid\",\"issuer\":\"praxisplaner-production-rehearsal\",\"subject\":\"$PROD_OPERATOR_WORKOS_USER_ID\"}" \
  migrationRehearsal:replaceReferenceTables \
  "$(node -e 'const fs=require("fs"); const manifest=JSON.parse(fs.readFileSync(".cache/migration/reports/production-rehearsal-references.json","utf8")); console.log(JSON.stringify({ appointmentTypes: manifest.references.appointmentTypes, locations: manifest.references.locations, practiceId: process.env.PROD_PRACTICE_ID, practitioners: manifest.references.practitioners, ruleSetId: process.env.PROD_RULE_SET_ID }));')"

pnpm exec convex env set \
  --deployment "$PROD_CONVEX_DEPLOYMENT" \
  MIGRATION_REHEARSAL_ENABLED false
```

The `--push` on the apply command intentionally deploys the local migration
operator gate and current `replaceReferenceTables` implementation before
running the mutation.

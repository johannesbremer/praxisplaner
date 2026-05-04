Convex seed snapshot for preview deployments.
Import with:

npx convex import --preview-name "$VERCEL_GIT_COMMIT_REF" .cache/seed/preview.zip

Build the generated zip before importing with:

pnpm run seed:preview

The generated `.cache/seed/preview.zip` archive is ignored by Git. Keep the
JSONL files in this directory as the source of truth.

This snapshot is synthetic pre-production data and is intended to be replaced,
not migrated, when the schema changes.

Contains a small synthetic dataset for:

- practices
- ruleSets
- practitioners
- locations
- appointmentTypes
- baseSchedules

Convex seed snapshot for preview deployments.
Import with:

npx convex import --preview-name "$VERCEL_GIT_COMMIT_REF" seed_data.zip

Rebuild the zip after breaking schema changes with:

pnpm run seed:preview

This snapshot is synthetic pre-production data and is intended to be replaced,
not migrated, when the schema changes.

Contains a small synthetic dataset for:

- practices
- ruleSetActivations
- ruleSets
- practitioners
- locations
- appointmentTypes
- baseSchedules

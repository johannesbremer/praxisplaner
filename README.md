# Praxisplaner

WIP

## WorkOS AuthKit setup

Praxisplaner uses the Convex WorkOS AuthKit component as the source of truth for
auth user synchronization. App `users` rows are created by WorkOS events, not by
client-side login code.

Configure a WorkOS webhook for each Convex deployment that should accept real
WorkOS login:

- Endpoint URL: `https://<convex-deployment>.convex.site/workos/webhook`
- Events: `user.created`, `user.updated`, `user.deleted`

Set the matching Convex environment variables:

```sh
npx convex env set WORKOS_CLIENT_ID=<your-client-id>
npx convex env set WORKOS_API_KEY=<your-api-key>
npx convex env set WORKOS_WEBHOOK_SECRET=<your-webhook-secret>
```

After the webhook and env vars are configured, backfill any users that already
exist in WorkOS:

```sh
npx convex run auth:backfillUsers
```

The backfill is idempotent and also runs the app `user.created` event handler,
so the local `users` table is populated through the same path as future webhook
deliveries.

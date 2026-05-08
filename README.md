# Praxisplaner

## TelefonKI worker

TelefonKI v2 lives in this repository under `agents/telefonki/agent.ts` and is
deployed as a shared LiveKit Cloud worker.

Runtime routing is multi-tenant by the dialed Practice number:

- `sip.trunkPhoneNumber` selects the Practice
- `sip.phoneNumber` identifies the caller / Phone Booking Identity

Useful commands:

```sh
pnpm dev:telefonki
pnpm start:telefonki
```

LiveKit Cloud deployment files:

- `Dockerfile`
- `livekit.telefonki.toml`

Practice phone numbers are stored in Convex and can be managed through the
`practices` Convex mutations. The shared worker does not infer tenancy from the
caller number.

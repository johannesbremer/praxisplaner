# Architecture Regeneration Notes

These notes preserve what was learned from the first implementation pass in
PRs 311-315. They are intentionally not an ADR: the intent is to seed a future
architecture pass after the code base has moved on, not to record a final
decision.

Use this together with `.agents/skills/improve-codebase-architecture/SKILL.md`,
`CONTEXT.md`, and `docs/adr/`.

## First-shot PRs

- PR 311, `Refactor appointment chains`: attempted to make real Appointment
  changes append replacement rows and show only current tails.
- PR 312, `Add planning adapter seam for calendar simulation`: attempted to
  expose a real/simulation planning adapter seam in the calendar planning
  modules.
- PR 313, `Refactor rule set activation into a dedicated module`: attempted to
  make Rule Set Activation a deeper Convex module with activation records.
- PR 314, `Refactor rule set lifecycle handling in /regeln`: attempted to move
  Draft Rule Set lifecycle selection and URL coordination out of the route.
- PR 315, `Refactor booking sessions to resolve active rule sets`: attempted to
  remove `ruleSetId` from Booking Session storage and resolve Active Rule Set
  state in Convex.

## Load-bearing discoveries

### Active Rule Set storage must be decided before PR 313 and PR 315 are regenerated

PR 313 and PR 315 conflict because they both touch the Active Rule Set model but
choose different sources of truth:

- PR 313 keeps `practices.currentActiveRuleSetId` and adds
  `ruleSetActivations.activatedRuleSetId` plus
  `previousActiveRuleSetId`.
- PR 315 removes `practices.currentActiveRuleSetId` and makes
  `ruleSetActivations.ruleSetId` the source of truth for the current Active
  Rule Set.

Before regenerating either change, choose one model. The domain direction in
`CONTEXT.md` is that Rule Set Activation preserves active-state history and is
the source of truth for the Practice's current Active Rule Set. That means a
future pass should prefer one activation table with one naming scheme, then make
every Active Rule Set read go through a single module.

The intended deep module is an Active Rule Set / Rule Set Activation module that
hides:

- how the current Active Rule Set is derived,
- how activation records are inserted,
- whether any fast read pointer exists,
- how initial Practice creation records its first activation,
- how Booking Session lookup behaves when no usable Active Rule Set exists.

Do not split this between separate `activeRuleSets.ts` and
`ruleSetActivation.ts` modules unless they have distinct interfaces with real
leverage.

Rule Set Activation also applies activation-bound Appointment changes. The
first shot kept that implementation in the activation module and patched
existing Appointments in place. That is only acceptable while Appointments are
still mutable. If Appointment replacement chains are regenerated as append-only,
activation-bound reassignment must call the Appointment replacement-chain module
instead of patching Appointment rows directly. Otherwise Rule Set Activation
will silently reintroduce an alternate Appointment mutation path and violate
ADR-0002.

Be precise about read semantics at this seam:

- invariant reads used by mutations may throw when the Practice has no Active
  Rule Set,
- nullable lookup queries should return `null` when no usable object exists,
- tests and seed data should create Active Rule Set state through the same
  module as production code, not by manually inserting partial activation rows.

### Booking Session lookup must preserve nullable read semantics

Removing `bookingSessions.ruleSetId` is still the right direction, but the first
shot showed that resolving Active Rule Set state too early can change access
semantics.

Future implementation constraint:

- `bookingSessions.get` must verify session ownership and early-null cases
  before resolving Active Rule Set state.
- `bookingSessions.getActiveForUser` is a nullable lookup. It should return
  `null` when no usable session exists. Hard Practice invariant failures belong
  in session creation or Booking Attempt mutations, not in nullable lookup
  queries.
- `/buchung` may not let a stale pending session id block recovery after the
  Active Rule Set changes. If the Active Rule Set changes and no usable session
  hydrates, the UI must be able to create a fresh session.

### Appointment replacement chains need a real current-tail model

PR 311 exposed that current-tail behavior cannot be implemented by filtering
only the records already returned by a day/range query. A replacement may move
outside the filtered subset, and the predecessor must still be treated as
superseded.

Future implementation constraint:

- Current-tail resolution must use the full replacement chain, or a stored
  chain state that makes the current tail explicit.
- Live occupancy must ignore superseded real Appointments, not just cancelled
  Appointments.
- Real Appointment tail guards must ignore simulation replacements unless the
  operation is explicitly in the simulation mode.
- Superseding a real Appointment must not let cancellation of the new tail
  resurrect the old time slot as active.
- Cross-day moves still follow ADR-0002: cancellation plus a new unrelated
  Appointment, not a replacement.

This probably needs a schema decision, not just query-local filtering. The
future pass should consider whether Appointment replacement chains need an
explicit root/current/retired representation, while preserving the ADR's
append-only intent.

### Calendar planning can be regenerated independently

PR 312 is comparatively self-contained. The useful discovery is that the
calendar already has two adapters in practice: real planning and simulation
planning. The future module should make that seam explicit so callers issue
planning commands without knowing when to convert real records into simulation
records or how replacement ids collapse optimistically.

### Draft Rule Set lifecycle can be regenerated independently

PR 314 is also comparatively self-contained. The useful discovery is that
`/regeln` should not own both route rendering and Draft Rule Set lifecycle
coordination. The future module should own selected/working/active/draft state,
URL resolution, pending draft navigation, equivalence state, and
blocking-unsaved-change decisions.

## Future prompt

Copy this prompt into a future coding session after closing PRs 311-315:

```text
You are working in /Users/johannes/Code/praxisplaner.

Run the repo instructions in AGENTS.md first, including:
- `npx @tanstack/intent@latest list` with network access,
- loading relevant TanStack Start / Router intent skills where the frontend
  route layer is touched,
- consulting Convex skills/docs where Convex schema, queries, mutations,
  atomicity, or subscription cost are touched.

Use `.agents/skills/improve-codebase-architecture/SKILL.md` and its vocabulary:
Module, Interface, Depth, Seam, Adapter, Leverage, Locality. Use `CONTEXT.md`
domain terms and respect `docs/adr/`, especially ADR-0002 about append-only
Appointment replacements.

Read `docs/architecture-regeneration-notes.md` before proposing or editing
anything. Treat it as lessons from closed PRs 311-315, not as code to copy.

Goal:
Regenerate the architecture work from PRs 311-315 against the current code base,
but do it in the correct dependency order and avoid the first-shot mistakes.

Required order:
1. Decide and implement the Active Rule Set / Rule Set Activation model first.
   Prefer Rule Set Activation as the source of truth for the current Active Rule
   Set unless the current code base has a stronger reason not to. Use one
   naming scheme for the activation table and one deep module for Active Rule
   Set reads and activation writes. Record initial Practice activation. Keep
   Convex transaction atomicity in mind.
2. Then remove Booking Session ownership of Rule Set state. Booking Session
   lookup should resolve availability from the Practice's current Active Rule
   Set, but nullable lookup queries must keep nullable semantics and ownership
   checks must happen before Active Rule Set resolution. Ensure `/buchung`
   recovers from stale pending sessions after an Active Rule Set change.
3. Then deepen Appointment replacement chains. Do not rely on filtering only
   the current query subset to find current tails. Live occupancy must ignore
   superseded real Appointments. Real update tail checks must ignore simulation
   replacements. Preserve ADR-0002: same-day changes are replacements;
   cross-day moves are cancellation plus a new unrelated Appointment.
4. Then regenerate the calendar planning adapter seam. Make real and simulation
   planning explicit adapters behind one command interface; hide conversion and
   optimistic replacement details from callers.
5. Then regenerate the Draft Rule Set lifecycle frontend module. Move selected,
   working, active, draft, URL resolution, pending draft navigation,
   equivalence state, and blocking-unsaved-change decisions out of the route.

For each step:
- inspect the current code first rather than replaying old PR patches,
- state the planned module/interface shape before editing,
- add or update focused tests at the module interface,
- run `pnpm gen` if Convex generated files are affected,
- run `pnpm --silent ci-check` with network access before claiming completion,
- if browser-visible behavior changes, test it in `$browser-use:browser`.

Do not add compatibility layers, migration helpers, fallback paths, or legacy
preserving abstractions unless the current code base has already become
production-like and explicitly requires them. This project is still allowed to
make breaking changes.
```

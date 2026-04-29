# Praxis Scheduling

Praxis Scheduling describes how a medical practice defines appointment availability, books appointments, and manages patient-facing booking through versioned scheduling rules.

## Language

**Practice**:
A medical practice that owns scheduling configuration, patients, appointments, and staff membership.
_Avoid_: Tenant, organization

**Practice Member**:
A user who has a staff, admin, or owner role in a Practice.
_Avoid_: Staff user, account

**Workspace**:
A named browser or device installation used to attribute staff actions.
_Avoid_: User, Practice Member, unnamed device

**Patient**:
A person receiving care, represented canonically by the Practice's PVS.
_Avoid_: Client, customer, patient entry

**PVS Patient**:
A Patient imported from the external practice management system and identified by a PVS patient number.
_Avoid_: Real patient

**Booking Identity**:
A person identity captured during appointment booking before or alongside association with a PVS Patient.
_Avoid_: User, patient entry

**Online Booking Identity**:
A Booking Identity created from an authenticated online booking user.
_Avoid_: Online patient

**Phone Booking Identity**:
A Booking Identity created through TelefonKI before association with a PVS Patient.
_Avoid_: Phone patient

**Integration Actor**:
An external system that performs actions in Praxisplaner.
_Avoid_: User, Booking Identity

**Temporary Patient**:
A staff-created provisional Booking Identity used before association with a PVS Patient.
_Avoid_: Placeholder patient

**Appointment**:
A reserved time interval for a PVS Patient or Booking Identity, Appointment Type, Location, and optionally a Practitioner.
_Avoid_: Booking, event

**Appointment Cancellation**:
A dedicated record that cancels an Appointment replacement chain without mutating the Appointments in it.
_Avoid_: Cancelled appointment field

**Series Cancellation**:
A dedicated record that cancels the remaining future Appointments in an Appointment Series as one action.
_Avoid_: Recurring cancellation

**Appointment Series**:
A set of related Appointments created from a follow-up plan.
_Avoid_: Recurring appointment

**Appointment Type**:
A versioned definition of appointment duration and follow-up plan.
_Avoid_: Visit type, service

**Follow-up Plan**:
An ordered plan for creating additional Appointments after a root Appointment.
_Avoid_: Recurrence rule, shared protocol

**Practitioner**:
A versioned clinician who can be assigned to Appointment Types, Base Schedules, Appointments, and Absences.
_Avoid_: Doctor, provider

**Medical Assistant**:
A versioned medical assistant tracked for absence planning but not used to determine appointment availability.
_Avoid_: MFA, assistant, staff

**Location**:
A versioned place where Appointments can happen.
_Avoid_: Site, office

**Base Schedule**:
A versioned weekly availability pattern for a Practitioner at a Location.
_Avoid_: Working hours, template

**Absence**:
A versioned absence for a Practitioner or Medical Assistant on a date and portion of the day.
_Avoid_: Vacation, leave, holiday

**Absence Provenance**:
The Absence reference recorded on a replacement Appointment created by automatic reassignment.
_Avoid_: Vacation provenance

**Blocked Slot**:
A manual block that makes a specific time interval unavailable at a Location.
_Avoid_: Sperrung outside German UI copy, closure, blackout

**Staff Override**:
A staff decision to create an Appointment despite a Scheduling Rule that would normally block it.
_Avoid_: Force booking, ignore rules

**Appointment Occupancy**:
The fact that an Appointment already reserves a concrete time interval at a Location and optionally for a Practitioner.
_Avoid_: Rule block, constraint

**Unresolved Appointment**:
An existing Appointment that remains scheduled against a schedulable resource no longer available in the Active Rule Set.
_Avoid_: Legacy appointment, orphaned appointment

**Rule Set**:
A versioned collection of scheduling entities and rules for one Practice.
_Avoid_: Configuration, calendar version

**Active Rule Set**:
The exactly one Rule Set currently used by the Practice for staff scheduling and online booking.
_Avoid_: Published version, live config

**Rule Set Activation**:
A historical record that a Rule Set became active for a Practice at a specific time.
_Avoid_: Active pointer

**Draft Rule Set**:
An unsaved Rule Set revision used to simulate and edit scheduling changes before activation.
_Avoid_: Working copy, sandbox, branch

**Draft Discard**:
An action that abandons the current Draft Rule Set without activation.
_Avoid_: Delete version

**Draft Save**:
An action that turns the current Draft Rule Set into a saved Rule Set without making it active.
_Avoid_: Activation

**Lineage Key**:
The stable identity of a versioned scheduling entity across Rule Sets.
_Avoid_: Original ID, canonical ID

**Scheduling Rule**:
A root rule condition tree that can block appointment slots matching its conditions.
_Avoid_: Constraint, filter

**Rule Condition**:
A node inside a Scheduling Rule tree that combines logical operators or tests one appointment attribute.
_Avoid_: Predicate, clause

**Candidate Slot**:
A concrete appointment possibility being evaluated for a date, time, Appointment Type, Location, and optionally a Practitioner.
_Avoid_: Slot, opening

**Available Slot**:
A Candidate Slot that passes Base Schedule, Absence, Blocked Slot, Appointment Occupancy, and Scheduling Rule checks.
_Avoid_: Free slot, bookable slot

**Rule Block**:
The result of a Scheduling Rule matching a Candidate Slot and preventing it from being booked.
_Avoid_: Conflict, validation error

**Booking Attempt**:
The server-side action that tries to turn selected Booking Session data into a confirmed Appointment.
_Avoid_: Slot selection, checkout

**Booking Session**:
An authenticated user's in-progress online appointment booking for a Practice.
_Avoid_: Wizard state, checkout

**Booking Path**:
The branch of a Booking Session for either new-patient intake or existing-patient intake.
_Avoid_: Flow, funnel

**Booking Intake**:
The personal, insurance, medical, and data-sharing information captured before a Booking Attempt.
_Avoid_: Form data, profile

## Relationships

- A **Practice** always has exactly one **Active Rule Set**.
- A **Practice** has many **Rule Set Activations**.
- A **Workspace** can be recorded as the actor for staff actions.
- A **Workspace** belongs to one **Practice**.
- A browser or device stores its selected **Workspace** locally.
- A browser or device does not switch to an existing **Workspace** by name.
- Creating or selecting a **Workspace** requires an authenticated **Practice Member**.
- Creating a **Workspace** is the bootstrap exception to requiring an existing **Workspace** id.
- **Workspace** records are append-only and use Convex-generated identity.
- **Workspace** names are unique within a **Practice** forever.
- A staff action that requires **Workspace** attribution must provide a valid **Workspace** id from browser storage.
- Staff reads require **Practice Member** access but not **Workspace** attribution.
- A **Practice** has many **Practice Members**, **Patients**, **Booking Identities**, **Appointments**, and **Rule Sets**.
- A **Practice** has operational calendar state such as **Appointments** and **Blocked Slots** outside **Rule Set** configuration.
- A **Practice Member** grants a user access to a **Practice**, but does not by itself make that user a **Practitioner**.
- A **Practice Member** controls access and permissions; **Workspace** attributes staff operational actions.
- A **Rule Set** contains versioned **Appointment Types**, **Practitioners**, **Medical Assistants**, **Locations**, **Base Schedules**, **Absences**, and **Scheduling Rules**.
- A **Draft Rule Set** can have a parent **Rule Set**.
- Only the initial **Rule Set** has no parent; every **Draft Rule Set** has a parent **Rule Set**.
- A **Practice** has at most one current **Draft Rule Set**.
- A **Draft Rule Set** is created automatically when staff first edits scheduling configuration.
- A **Draft Rule Set** records the **Workspace** that created it and when it was created.
- Activating a **Draft Rule Set** immediately makes it the **Practice**'s **Active Rule Set**.
- Activating a **Draft Rule Set** creates a **Rule Set Activation** record.
- Activating a **Draft Rule Set** consumes the current draft; no new draft exists until the next edit.
- Saving a **Draft Rule Set** creates a saved **Rule Set** without changing the **Active Rule Set**.
- **Draft Save** requires the saved **Rule Set** description.
- Saving a **Draft Rule Set** consumes the current draft.
- **Draft Save** records the acting **Workspace**.
- A saved inactive **Rule Set** can be activated later.
- Activating any saved **Rule Set** creates a **Rule Set Activation** record.
- **Rule Set Activation** records the acting **Workspace**.
- Activating the already **Active Rule Set** is invalid.
- **Rule Set Activation** is atomic with the automatic reassignment replacements it generates.
- Unresolved leftovers do not block **Rule Set Activation**.
- Editing a saved **Rule Set** creates a new **Draft Rule Set** based on it.
- Discarding a **Draft Rule Set** abandons pending scheduling changes and returns editing to the **Active Rule Set** state.
- **Draft Discard** records the acting **Workspace** and time.
- **Draft Discard** is a durable record.
- **Draft Discard** removes the mutable Draft Rule Set contents.
- **Draft Discard** records which **Rule Set** the draft was based on and may record which **Workspace** created the draft.
- **Draft Rule Set** creation provenance is lightweight metadata, not append-only draft edit history.
- **Draft Rule Set** does not track last-modified Workspace metadata for mutable draft edits.
- **Draft Rule Set** edits are mutable working state until activation.
- A **Rule Set Activation** records the **Workspace** that activated it.
- Staff changes record the acting **Workspace**.
- GDT import is attributed to the acting **Workspace**.
- Online patient actions record the acting **Online Booking Identity**.
- TelefonKI actions record the **Phone Booking Identity** for the caller and may separately record the **Integration Actor** that performed the action.
- An activated **Rule Set** has a required human description explaining the scheduling change.
- A versioned scheduling entity can keep the same **Lineage Key** across multiple **Rule Sets**.
- A **Base Schedule** belongs to exactly one **Practitioner** and one **Location** through their Lineage Keys.
- Breaks are part of a **Base Schedule** because they describe regular weekly availability.
- An **Appointment** belongs to exactly one **Practice**, one **Appointment Type** lineage, one **Location** lineage, and optionally one **PVS Patient** or one **Booking Identity** and one **Practitioner** lineage.
- An **Appointment** references **Appointment Type**, **Location**, and optionally **Practitioner** by **Lineage Key**.
- An **Appointment** snapshots the appointment type display name, duration, Location name, and Practitioner name used at booking time.
- An **Appointment Series** has exactly one root **Appointment** and one root **Appointment Type**.
- A **Follow-up Plan** belongs to an **Appointment Type** and can produce an **Appointment Series**.
- An **Absence** belongs to either one **Practitioner** lineage or one **Medical Assistant** lineage.
- **Medical Assistant** Absence is tracked for unified absence planning but currently does not affect appointment availability or reassignment.
- **Practitioner** Absence can automatically reassign affected **Appointments** when a valid replacement is available.
- **Practitioner** Absence leaves affected **Appointments** unresolved for staff when automatic reassignment is not possible.
- Unresolved leftovers are affected **Appointments** that could not be automatically reassigned.
- Automatic reassignment creates replacement **Appointments** in the same append-only chain.
- Automatic reassignment records the **Absence** and **Rule Set** provenance that generated the replacement.
- A reassignment replacement **Appointment** records the **Rule Set** whose activation generated it.
- **Absence Provenance** links an automatically reassigned replacement **Appointment** to the **Absence** that caused it.
- Activating a **Rule Set** may leave existing **Appointments** unresolved instead of blocking activation.
- **Unresolved Appointments** remain visible and editable in non-bookable legacy calendar columns until staff resolves them.
- **Unresolved Appointment** is inferred from the current **Active Rule Set** and remaining operational **Appointments**, not stored as mutable state.
- **Scheduling Rules** affect candidate slots for new booking attempts; they do not make existing **Appointments** unresolved.
- Removed **Appointment Types** prevent new bookings of that type but do not make existing **Appointments** unresolved.
- A **Blocked Slot** makes one concrete time interval unavailable.
- A **Blocked Slot** references **Location** and optionally **Practitioner** by **Lineage Key**.
- A **Scheduling Rule** is a root **Rule Condition** with child **Rule Conditions**.
- A **Scheduling Rule** can block many candidate appointment slots by matching their attributes.
- A **Candidate Slot** belongs to exactly one **Practice**, one **Appointment Type**, one **Location**, and optionally one **Practitioner**.
- A **Candidate Slot** can become an **Available Slot** only if it is inside a **Base Schedule** and outside relevant **Absences**, **Blocked Slots**, **Appointment Occupancy**, and **Rule Blocks**.
- **Appointment Occupancy** is not a **Scheduling Rule** and cannot be overridden by a **Staff Override**.
- A **Rule Block** identifies which **Scheduling Rules** matched the **Candidate Slot**.
- A **Rule Block** can be bypassed only by an explicit **Staff Override**.
- A **Blocked Slot** and **Appointment Occupancy** block booking before **Scheduling Rules** are considered.
- **Available Slots** are advisory until a **Booking Attempt** validates the selected **Candidate Slot** server-side.
- Online slot selection does not reserve the selected **Candidate Slot**.
- Practitioner suitability for an **Appointment Type** is expressed through **Scheduling Rules**, not owned by the **Appointment Type**.
- A **Booking Session** belongs to exactly one authenticated user and one **Practice**.
- A **Booking Session** follows one **Booking Path**.
- A **Booking Session** accumulates **Booking Intake** before a **Booking Attempt**.
- A **Booking Attempt** belongs to one **Booking Session** when created through online booking.
- A **Booking Attempt** either creates one confirmed **Appointment** or fails without reserving the selected **Candidate Slot**.
- A **Booking Session** does not store or own a **Rule Set**.
- A **Booking Session** always presents availability derived from the **Practice**'s current **Active Rule Set**.
- A **Booking Session** lookup returning none means no usable session exists for the authenticated user; it does not mean the **Practice** lacks an **Active Rule Set**.
- Online booking availability follows the **Practice**'s current **Active Rule Set** until the discrete booking attempt.
- A booking attempt must be validated server-side against the **Practice**'s current **Active Rule Set**.
- A successful **Booking Attempt** records the validating **Rule Set** on the created **Appointment** for auditability.
- Manual staff-created appointments and online-booked appointments use the same server-side validation against the current **Active Rule Set** by default.
- Staff overrides are explicit exceptions and record that scheduling rules were overridden.
- A confirmed **Appointment** snapshots the **Rule Set** used to validate the booking attempt.
- An **Appointment** records the **Rule Set** used to validate its creation.
- A **Staff Override** belongs to the **Appointment** it allowed and records which **Scheduling Rule** was overridden.
- Changing an **Appointment** creates a replacement **Appointment** linked to the previous one.
- Convex should not expose an in-place edit operation for existing **Appointments**.
- Cancelling an **Appointment** creates an **Appointment Cancellation** record for the root **Appointment** instead of mutating any **Appointment** in the chain.
- Cancelling an **Appointment Series** creates a **Series Cancellation** for remaining future Appointments only.
- A **Series Cancellation** creates or references one **Appointment Cancellation** per remaining future root **Appointment**.
- A single future follow-up in an **Appointment Series** can still be cancelled with an **Appointment Cancellation**.
- Editing or rescheduling one **Appointment** in an **Appointment Series** does not implicitly edit the rest of the series.
- Absence-driven reassignment preserves **Appointment Series** membership.
- UI may warn staff when editing or cancelling an **Appointment** that belongs to an **Appointment Series** and offer an explicit **Series Cancellation** for remaining follow-ups.
- An **Appointment** replacement applies only within the same calendar day.
- Moving an **Appointment** to another day is an **Appointment Cancellation** plus a new **Appointment**, not a replacement.
- An **Appointment** replacement chain has a root **Appointment** and a current tail **Appointment**.
- A root **Appointment** is inferred by the absence of `replacesAppointmentId`.
- A current tail **Appointment** is inferred by the absence of a later same-day replacement pointing to it.
- Day views show only the current tail **Appointments**.
- Appointment history views walk from a selected current tail **Appointment** back to the root.
- A **Booking Identity** may be associated with one **PVS Patient**.
- An **Online Booking Identity**, **Phone Booking Identity**, and **Temporary Patient** are kinds of **Booking Identity**.
- An **Online Booking Identity** is authenticated.
- Once a **Booking Identity** is associated with a **PVS Patient**, appointment-history rules evaluate against the **PVS Patient** history rather than only the original booking channel.
- Associating a **Booking Identity** with a **PVS Patient** is a staff-correctable identity merge with scheduling consequences.

## Example Dialogue

> **Dev:** "When a **Practice** edits a **Practitioner**, do existing **Appointments** point at the edited row?"
> **Domain expert:** "No. The **Appointment** keeps the **Practitioner** by **Lineage Key**, so the reference survives across **Rule Sets**."
>
> **Dev:** "Does a **Draft Rule Set** affect online booking?"
> **Domain expert:** "No. Online booking follows the **Active Rule Set** for the **Practice**."

## Flagged Ambiguities

- The code and UI use both "doctor" and **Practitioner** for clinician selection; prefer **Practitioner** unless the user-facing German copy intentionally says doctor/Arzt.
- The code uses "booking" both for the online flow and for the resulting **Appointment**; prefer **Booking Session** for the in-progress flow and **Appointment** for the reserved slot.
- **Rule Set** is the canonical domain term; avoid broader names like scheduling policy or scheduling plan because they blur the distinction from **Scheduling Rules**, **Base Schedules**, and **Follow-up Plans**.
- **Rule Set** description is provided when a **Draft Rule Set** is saved; direct activation of a draft collects the description as part of saving and activating it.
- **Rule Set Activation** preserves when each **Rule Set** became active and is the source of truth for the **Practice**'s current **Active Rule Set**.
- **Rule Set Activation** is created whether activation starts from a **Draft Rule Set** or a saved inactive **Rule Set**.
- **Rule Set Activation** records meaningful active-state changes, not repeated activation of the same **Rule Set**.
- **Workspace** attribution is required for staff operational actions, including remote use from a phone or tablet.
- **Workspace** attribution is required for staff writes and operational actions, not ordinary staff reads.
- **Workspace** identity is scoped to a **Practice**.
- **Workspace** is a managed **Practice** resource in Convex; browser storage selects which **Workspace** is acting.
- **Workspace** registration is authenticated Practice behavior, not anonymous device self-registration.
- **Workspace** creation requires **Practice Member** access but not prior **Workspace** attribution.
- **Workspace** names are never reused within a **Practice**, so audit records can store only the **Workspace** id.
- A browser cannot recover a **Workspace** id from a display name; if the locally stored id is missing, staff must create a new uniquely named **Workspace**.
- If a browser loses its stored **Workspace** id, it creates a new **Workspace** rather than selecting an existing one by name.
- **Workspace** is not part of **Rule Set** versioning because it is audit/actor state, not scheduling configuration.
- **Workspace** attribution applies to staff scheduling and calendar changes, including **Rule Set Activation**, **Appointment** replacement, **Appointment Cancellation**, **Blocked Slot** changes, and **Absence** changes.
- **Workspace** attribution applies to **Draft Rule Set** creation, discard, save, and activation, but not ordinary mutable draft edits.
- Draft edit history is not append-only domain history; **Rule Set Activation** is the durable history boundary.
- Draft creation is automatic on first edit; activation is explicit.
- After activation, the next **Draft Rule Set** is created only by the next scheduling edit.
- **Draft Discard** is explicit; continuing edits modify the same current **Draft Rule Set**.
- **Draft Discard** is a **Workspace**-attributed staff action.
- **Draft Save** and **Rule Set Activation** are separate actions.
- Direct save-and-activate performs **Draft Save** and **Rule Set Activation** atomically.
- Staff can save a **Draft Rule Set** first and activate the saved inactive **Rule Set** later, or save-and-activate in one atomic operation.
- Activation and generated automatic reassignment replacements succeed or fail together.
- Invalid or partially generated automatic replacements fail activation; unresolved leftovers remain for staff handling.
- After **Draft Save**, further edits create a new **Draft Rule Set** from the chosen saved or active **Rule Set**.
- A saved inactive **Rule Set** is immutable scheduling version state that can later become the **Active Rule Set**.
- Saved **Rule Sets** are immutable; edits always happen through a new **Draft Rule Set**.
- **Draft Discard** preserves audit visibility without making every draft edit append-only.
- Discarded draft contents are not retained as domain history.
- **Workspace** attribution is only for staff actions; online patient actions are attributed to the authenticated **Online Booking Identity**.
- **Phone Booking Identity** identifies the caller; **Integration Actor** identifies the external system that created or changed records.
- PVS is the source of **PVS Patient** truth, but GDT import is a **Workspace** action.
- Current implementation gap: **Workspace** attribution is not implemented yet.
- Parentless **Rule Sets** are only valid for initial practice setup.
- A **Practice** has one current **Draft Rule Set**; competing **Rule Set** branches are not part of the domain model.
- **Lineage Key** is domain language for stable identity across **Rule Sets**, not just a database implementation detail.
- **Blocked Slot** and **Scheduling Rule** are separate concepts: a **Blocked Slot** is manual and concrete, while a **Scheduling Rule** is reusable and conditional.
- **Blocked Slot** is the canonical domain term; "Sperrung" is acceptable German UI copy but should not replace the English domain term.
- **Blocked Slot** is operational calendar state, separate from **Rule Set** configuration like **Appointments**.
- Operational **Blocked Slots** use **Lineage Keys** to refer to versioned schedulable resources across **Rule Sets**.
- Breaks are not separate domain objects; model them as part of **Base Schedule**, distinct from concrete **Blocked Slots**.
- **Appointment Series** only describes **Appointments** generated from a **Follow-up Plan**; recurring appointments are not part of this concept.
- **Follow-up Plan** is owned by one **Appointment Type**, not a reusable standalone plan.
- **Appointment Type** does not own eligible **Practitioners**; use **Scheduling Rules** to express the few practitioner/appointment-type combinations that should be blocked.
- **Appointment Type** remains part of **Rule Set** scheduling configuration even without owning practitioner eligibility.
- **Location** remains part of **Rule Set** scheduling configuration.
- **Practitioner** and **Medical Assistant** remain part of **Rule Set** scheduling configuration as schedulable resources, not stable HR/person records.
- **Absence** remains part of **Rule Set** scheduling configuration.
- **Medical Assistant** Absence is included to avoid split-brain absence planning, not because it currently changes scheduling capacity.
- **Practitioner** Absence supports mixed reassignment outcomes: some affected **Appointments** can be automatically rescheduled, while others require staff handling.
- Staff views may show the **Rule Set** description associated with automatic reassignment as the explanation for why an **Appointment** moved.
- A removed **Practitioner** can remain visible as a non-bookable legacy calendar column while unresolved future **Appointments** still reference that **Practitioner** by **Lineage Key**.
- A removed **Location** can remain visible as a non-bookable legacy calendar view while unresolved future **Appointments** still reference that **Location** by **Lineage Key**.
- Removed **Locations** can create **Unresolved Appointments** in the same way as removed **Practitioners**.
- **Unresolved Appointments** still occupy their scheduled time.
- **Unresolved Appointment** is about existing **Appointments** losing an active schedulable resource or failing automatic **Absence** reassignment, not about newly activated **Scheduling Rules** blocking future slots.
- **Unresolved Appointment** is the domain term; legacy/grayed columns are the view presentation for unresolved resources.
- Do not store **Unresolved Appointment** as a durable status; infer it from active schedulable resources and remaining **Appointments** that were not successfully replaced.
- Removed **Appointment Types** do not create **Unresolved Appointments** because existing **Appointments** keep booking-time snapshots.
- Current implementation mismatch: the code still stores allowed practitioner lineage keys on **Appointment Type**.
- Current implementation mismatch: the code still uses vacation naming for **Absence** and **Absence Provenance**.
- **Practice Member** and **Practitioner** are separate concepts: a **Practice Member** controls access to a **Practice**, while a **Practitioner** is a schedulable clinician in a **Rule Set**.
- **Practice Member** and **Workspace** are separate concepts: **Practice Member** answers who may access the Practice, while **Workspace** answers which named browser or device performed an action.
- **PVS Patient** is the canonical patient concept; **Booking Identity** covers online, TelefonKI, and temporary identities that can later be associated with a **PVS Patient**.
- A **Booking Identity** association is not a casual toggle; it affects appointment history and history-based **Scheduling Rules**, while still needing staff correction when matched incorrectly.
- Use **Patient** only as broad clinical language; use **PVS Patient** or **Booking Identity** when identity, matching, storage, or scheduling-rule behavior matters.
- Anonymous online booking is not part of **Online Booking Identity**.
- **Booking Session** should not freeze availability semantics to an older **Rule Set**; the decisive moment is the server-side booking attempt against the current **Active Rule Set**.
- **Booking Session** should not own a **Rule Set** reference; storing `ruleSetId` on booking session state risks freezing availability semantics before the booking attempt.
- **Appointment** may keep **Rule Set** provenance from the booking attempt even though **Booking Session** should not.
- **Rule Set** provenance points to the **Rule Set** active at the decisive moment: booking validation for creation, activation for reassignment.
- Operational **Appointments** use **Lineage Keys** to refer to versioned schedulable resources across **Rule Sets**.
- **Appointment** snapshots explain what was booked; **Lineage Keys** support grouping and identity across **Rule Sets**.
- **Appointment** snapshots also support reassignment explanations, such as showing the Practitioner an Appointment was originally booked with before an **Absence**-driven reassignment.
- **Appointment** history is append-only: each change creates a new **Appointment** with `replacesAppointmentId` pointing at the previous one.
- **Appointment Cancellation** keeps cancellation append-only without adding cancellation fields to **Appointment**.
- **Appointment Cancellation** points to the root **Appointment** and makes the whole replacement chain inactive in day views.
- **Series Cancellation** groups the action of cancelling all remaining future Appointments in an **Appointment Series**; past Appointments in the series remain historical.
- **Series Cancellation** is an abstraction over **Appointment Cancellation**, not a separate day-view cancellation mechanism.
- Series-wide effects are explicit actions, not automatic consequences of editing one **Appointment** or Absence-driven reassignment.
- **Appointment** replacement chains are same-day only, matching the single-day calendar drag/drop model and keeping day-scoped queries simple.
- Cross-day rescheduling does not use `replacesAppointmentId`; it cancels the original **Appointment** and creates a new unrelated **Appointment**.
- **Appointment** chain queries should distinguish root **Appointments**, current tail **Appointments**, and historical links.
- Do not store a redundant root boolean for **Appointments**; infer root status from whether `replacesAppointmentId` is absent.
- Do not store a mutable current-tail flag for **Appointments**; infer it within same-day, single-Practice, single-Location queries.
- Staff-created and online-booked **Appointments** share default scheduling validation; only explicit staff overrides bypass **Scheduling Rules**.
- **Staff Override** does not apply to **Blocked Slots**. To book inside a **Blocked Slot**, staff must first remove or shorten the **Blocked Slot**.
- **Staff Override** does not apply to existing **Appointment** occupancy.
- The existing "Trotzdem buchen" modal is the UI surface for a **Staff Override** only for rule-based blocks; manual **Blocked Slots** should not allow booking on top because they are edited like calendar objects.
- **Candidate Slot** is the domain term for one possible appointment being evaluated; use plain "slot" only in UI copy or low-level code.
- **Available Slot** means all relevant availability checks passed at the time of evaluation, but it is not a reservation.
- **Rule Block** is the Scheduling Rule outcome; do not use it for **Blocked Slots** or **Appointment Occupancy**.
- **Booking Attempt** is the decisive booking moment; earlier **Booking Session** steps only collect intake and selection state.
- **Booking Intake** is patient-facing booking information, not the canonical **PVS Patient** record.

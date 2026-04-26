# Defer Workspace attribution until Workspaces exist

Praxisplaner records Rule Set Activation history as durable Convex records now, but does not yet attach a Workspace actor to those records. The domain model still requires Workspace attribution for staff operational actions, including Rule Set Activation, Draft Save, and Draft Discard; this ADR records that the current implementation is intentionally incomplete until the Workspace model is implemented.

We do not store a string placeholder for Workspace attribution because that would weaken the audit interface and make invalid actor data look authoritative. When Workspaces are added, lifecycle mutations should require an `Id<"workspaces">`, validate that it belongs to the Practice, and write it to activation and draft lifecycle records.

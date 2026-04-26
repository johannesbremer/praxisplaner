# Booking identities associate with PVS patients

Praxisplaner treats the PVS patient record as the canonical patient identity, while online, TelefonKI, and temporary booking identities may exist before they can be matched to that record. We keep those booking identities separate and associate them with a PVS patient through a staff-correctable identity merge, so history-based scheduling rules can evaluate against the canonical patient history without losing the source and lifecycle differences of each booking channel.

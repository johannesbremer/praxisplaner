export interface OfferedTelefonkiSlot {
  locationLineageKey: string;
  practitionerLineageKey: string;
  practitionerName: string;
  startTime: string;
}

interface BookingPrerequisiteState {
  appointmentType?: unknown;
  birthDate?: string;
  firstName?: string;
  isNewPatient?: boolean;
  lastName?: string;
  location?: unknown;
  phoneNumber?: string;
  reason?: string;
}

export function buildOfferedSlotId(slot: OfferedTelefonkiSlot): string {
  return [
    slot.startTime,
    slot.locationLineageKey,
    slot.practitionerLineageKey,
  ].join("::");
}

export function listMissingBookingPrerequisites(
  state: BookingPrerequisiteState,
): string[] {
  const missing: string[] = [];
  if (state.isNewPatient === undefined) {
    missing.push("Patientenstatus");
  }
  if (!state.location) {
    missing.push("Standort");
  }
  if (!state.reason) {
    missing.push("Termingrund");
  }
  if (!state.birthDate) {
    missing.push("Geburtsdatum");
  }
  if (!state.firstName) {
    missing.push("Vorname");
  }
  if (!state.lastName) {
    missing.push("Nachname");
  }
  if (!state.appointmentType) {
    missing.push("Terminart");
  }
  if (!state.phoneNumber) {
    missing.push("Telefonnummer");
  }
  return missing;
}

export function renderOfferedSlots<T extends OfferedTelefonkiSlot>(args: {
  formatSlot: (slot: T) => string;
  slots: readonly T[];
  store: Map<string, T>;
}): string {
  if (args.slots.length === 0) {
    args.store.clear();
    return "Es wurden keine passenden freien Termine gefunden.";
  }

  args.store.clear();

  return args.slots
    .map((slot, index) => {
      const offerId = buildOfferedSlotId(slot);
      args.store.set(offerId, slot);
      return `${index + 1}. ${args.formatSlot(slot)} (offerId: ${offerId})`;
    })
    .join("; ");
}

export function sanitizePhoneNumber(rawPhoneNumber: string): string {
  const phoneNumber = rawPhoneNumber.trim();
  if (phoneNumber.length === 0) {
    throw new Error("Telefonnummer darf nicht leer sein.");
  }
  return phoneNumber;
}

import { Temporal } from "temporal-polyfill";
import { z } from "zod";

export interface OfferedTelefonkiSlot {
  locationLineageKey: string;
  practitionerLineageKey: string;
  practitionerName: string;
  startTime: string;
}

export interface StoredTelefonkiOffer<T extends OfferedTelefonkiSlot> {
  criteria: TelefonkiOfferCriteria;
  slot: T;
}

export interface TelefonkiOfferCriteria {
  appointmentTypeLineageKey: string;
  birthDate?: string;
  isNewPatient: boolean;
  locationLineageKey: string;
  practitionerLineageKey?: string;
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

export function buildTelefonkiOfferCriteria(args: {
  appointmentTypeLineageKey: string;
  birthDate?: string;
  isNewPatient: boolean;
  locationLineageKey: string;
  practitionerLineageKey?: string;
}): TelefonkiOfferCriteria {
  return {
    appointmentTypeLineageKey: args.appointmentTypeLineageKey,
    ...(args.birthDate ? { birthDate: args.birthDate } : {}),
    isNewPatient: args.isNewPatient,
    locationLineageKey: args.locationLineageKey,
    ...(args.practitionerLineageKey
      ? { practitionerLineageKey: args.practitionerLineageKey }
      : {}),
  };
}

export function clearOfferedSlots<T extends OfferedTelefonkiSlot>(
  store: Map<string, StoredTelefonkiOffer<T>>,
): void {
  store.clear();
}

export function formatTelefonkiDate(isoDate: string): string {
  return Temporal.PlainDate.from(isoDate).toLocaleString("de-DE", {
    dateStyle: "long",
  });
}

export function formatTelefonkiDateTime(zonedDateTime: string): string {
  return Temporal.ZonedDateTime.from(zonedDateTime).toLocaleString("de-DE", {
    dateStyle: "full",
    hour12: false,
    timeStyle: "short",
  });
}

export function isStoredOfferCompatible(
  currentCriteria: TelefonkiOfferCriteria,
  storedCriteria: TelefonkiOfferCriteria,
): boolean {
  return (
    currentCriteria.appointmentTypeLineageKey ===
      storedCriteria.appointmentTypeLineageKey &&
    currentCriteria.birthDate === storedCriteria.birthDate &&
    currentCriteria.isNewPatient === storedCriteria.isNewPatient &&
    currentCriteria.locationLineageKey === storedCriteria.locationLineageKey &&
    currentCriteria.practitionerLineageKey ===
      storedCriteria.practitionerLineageKey
  );
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
  criteria: TelefonkiOfferCriteria;
  formatSlot: (slot: T) => string;
  slots: readonly T[];
  store: Map<string, StoredTelefonkiOffer<T>>;
}): string {
  if (args.slots.length === 0) {
    args.store.clear();
    return "Es wurden keine passenden freien Termine gefunden.";
  }

  args.store.clear();

  return args.slots
    .map((slot, index) => {
      const offerId = buildOfferedSlotId(slot);
      args.store.set(offerId, {
        criteria: args.criteria,
        slot,
      });
      return `${index + 1}. ${args.formatSlot(slot)} (offerId: ${offerId})`;
    })
    .join("; ");
}

export function sanitizePhoneNumber(rawPhoneNumber: string): string {
  const phoneNumber = rawPhoneNumber.trim();
  if (phoneNumber.length === 0) {
    throw new Error("Telefonnummer darf nicht leer sein.");
  }
  const parsedPhoneNumber = z.e164().safeParse(phoneNumber);
  if (!parsedPhoneNumber.success) {
    throw new Error(
      "Telefonnummer muss im E.164-Format angegeben werden, zum Beispiel +491701234567.",
    );
  }
  return parsedPhoneNumber.data;
}

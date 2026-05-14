import { Temporal } from "temporal-polyfill";
import { z } from "zod";

export interface ActiveTelefonkiOffers<T extends OfferedTelefonkiSlot> {
  generatedAt: number | undefined;
  offers: Map<string, StoredTelefonkiOffer<T>>;
  searchRequest: TelefonkiSearchRequest | undefined;
  searchVersion: number;
}

export interface OfferedTelefonkiSlot {
  locationLineageKey: string;
  practitionerLineageKey: string;
  practitionerName: string;
  startTime: string;
}

export interface StoredTelefonkiOffer<T extends OfferedTelefonkiSlot> {
  criteria: TelefonkiOfferCriteria;
  criteriaFingerprint: string;
  generatedAt: number;
  offerId: string;
  searchVersion: number;
  slot: T;
}

export interface TelefonkiOfferCriteria {
  appointmentTypeLineageKey: string;
  birthDate?: string;
  isNewPatient: boolean;
  locationLineageKey: string;
  practitionerLineageKey?: string;
}

export type TelefonkiOfferInvalidationReason =
  | "booked"
  | "criteria_changed"
  | "expired"
  | "stale_version";

export type TelefonkiSearchRequest =
  | { date: string; kind: "availableSlotsOnDate"; limit: number }
  | { kind: "nextAvailableAfternoonSlot" }
  | { kind: "nextAvailableAfternoonSlots"; limit: number }
  | { kind: "nextAvailableSlot" }
  | { kind: "nextAvailableSlots"; limit: number };

interface BookingPrerequisiteState {
  appointmentType?: unknown;
  birthDate?: string;
  firstName?: string;
  isNewPatient?: boolean;
  lastName?: string;
  location?: unknown;
  phoneNumber?: string;
  practitionerSelection?: unknown;
  reason?: string;
}

export const TELEFONKI_OFFER_TTL_MS = 5 * 60 * 1000;

export function advanceSearchVersion<T extends OfferedTelefonkiSlot>(
  activeOffers: ActiveTelefonkiOffers<T>,
): number {
  activeOffers.searchVersion += 1;
  clearOfferedSlots(activeOffers);
  return activeOffers.searchVersion;
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

export function buildTelefonkiOfferCriteriaFingerprint(
  criteria: TelefonkiOfferCriteria,
): string {
  return [
    criteria.appointmentTypeLineageKey,
    criteria.birthDate ?? "",
    criteria.isNewPatient ? "new" : "known",
    criteria.locationLineageKey,
    criteria.practitionerLineageKey ?? "",
  ].join("::");
}

export function clearOfferedSlots<T extends OfferedTelefonkiSlot>(
  activeOffers: ActiveTelefonkiOffers<T>,
): void {
  activeOffers.generatedAt = undefined;
  activeOffers.offers.clear();
  activeOffers.searchRequest = undefined;
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

export function isStoredOfferCompatible<T extends OfferedTelefonkiSlot>(args: {
  activeOffers: ActiveTelefonkiOffers<T>;
  currentCriteria: TelefonkiOfferCriteria;
  now?: number;
  storedOffer: StoredTelefonkiOffer<T>;
  ttlMs?: number;
}): null | TelefonkiOfferInvalidationReason {
  if (args.storedOffer.searchVersion !== args.activeOffers.searchVersion) {
    return "stale_version";
  }

  if (
    args.storedOffer.criteriaFingerprint !==
    buildTelefonkiOfferCriteriaFingerprint(args.currentCriteria)
  ) {
    return "criteria_changed";
  }

  const now = args.now ?? Temporal.Now.instant().epochMilliseconds;
  const ttlMs = args.ttlMs ?? TELEFONKI_OFFER_TTL_MS;
  if (now - args.storedOffer.generatedAt > ttlMs) {
    return "expired";
  }

  return null;
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
  if (!state.practitionerSelection) {
    missing.push("Behandler");
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
  activeOffers: ActiveTelefonkiOffers<T>;
  criteria: TelefonkiOfferCriteria;
  formatSlot: (slot: T) => string;
  now?: number;
  searchRequest: TelefonkiSearchRequest;
  slots: readonly T[];
}): string {
  if (args.slots.length === 0) {
    clearOfferedSlots(args.activeOffers);
    return "Es wurden keine passenden freien Termine gefunden.";
  }

  clearOfferedSlots(args.activeOffers);
  const generatedAt = args.now ?? Temporal.Now.instant().epochMilliseconds;
  const criteriaFingerprint = buildTelefonkiOfferCriteriaFingerprint(
    args.criteria,
  );
  args.activeOffers.generatedAt = generatedAt;
  args.activeOffers.searchRequest = args.searchRequest;

  return args.slots
    .map((slot, index) => {
      const offerId = buildOfferedSlotId(slot);
      args.activeOffers.offers.set(offerId, {
        criteria: args.criteria,
        criteriaFingerprint,
        generatedAt,
        offerId,
        searchVersion: args.activeOffers.searchVersion,
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

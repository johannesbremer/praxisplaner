import type { FunctionReturnType } from "convex/server";

import {
  cli,
  defineAgent,
  type JobContext,
  llm,
  ServerOptions,
  voice,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { RoomEvent } from "livekit-client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import type { Id } from "../../convex/_generated/dataModel";

import { api as convexApi } from "../../convex/_generated/api";
import {
  type ActiveTelefonkiOffers,
  advanceSearchVersion,
  buildTelefonkiOfferCriteria,
  clearOfferedSlots,
  formatTelefonkiDate,
  formatTelefonkiDateTime,
  isStoredOfferCompatible,
  listMissingBookingPrerequisites,
  renderOfferedSlots,
  sanitizePhoneNumber,
} from "./agent-state";
import { resolveCallRouting } from "./call-routing";
import { buildTelefonkiInstructions } from "./instructions";

const AGENT_NAME = "telefonki-agent";
const DEFAULT_INTEGRATION_ACTOR = "telefonki-livekit-agent";

type ActiveConfig = FunctionReturnType<
  typeof convexApi.telefonki.getActiveConfig
>;
type AppointmentTypeChoice = ActiveConfig["appointmentTypes"][number];
interface BookingIntentState {
  appointmentType?: AppointmentTypeChoice;
  birthDate?: string;
  firstName?: string;
  isNewPatient?: boolean;
  lastName?: string;
  location?: LocationChoice;
  phoneNumber?: string;
  practitioner?: PractitionerChoice;
  reason?: string;
}
interface CallState {
  activeOffers: ActiveTelefonkiOffers<TelefonkiSlot>;
  bookingIntent: BookingIntentState;
  phoneBookingIdentityId?: Id<"phoneBookingIdentities">;
}
type LocationChoice = ActiveConfig["locations"][number];

type PractitionerChoice = ActiveConfig["practitioners"][number];

type TelefonkiSlot = NonNullable<
  FunctionReturnType<typeof convexApi.telefonki.nextAvailableSlot>
>;

function buildCurrentOfferCriteria(state: BookingIntentState) {
  if (!state.appointmentType || !state.location) {
    throw new Error(
      "Terminart und Standort müssen vor der Terminsuche gespeichert sein.",
    );
  }
  if (state.isNewPatient === undefined) {
    throw new Error(
      "Patientenstatus muss vor der Terminsuche gespeichert sein.",
    );
  }

  return buildTelefonkiOfferCriteria({
    appointmentTypeLineageKey: state.appointmentType.lineageKey,
    ...(state.birthDate ? { birthDate: state.birthDate } : {}),
    isNewPatient: state.isNewPatient,
    locationLineageKey: state.location.lineageKey,
    ...(state.practitioner
      ? { practitionerLineageKey: state.practitioner.lineageKey }
      : {}),
  });
}

function buildSimulatedContext(state: BookingIntentState) {
  if (!state.appointmentType || !state.location) {
    throw new Error(
      "Terminart und Standort müssen vor der Terminsuche gespeichert sein.",
    );
  }

  return {
    appointmentTypeLineageKey: state.appointmentType.lineageKey,
    locationLineageKey: state.location.lineageKey,
    patient: {
      ...(state.birthDate && { dateOfBirth: state.birthDate }),
      isNew: state.isNewPatient ?? false,
    },
    ...(state.practitioner && {
      practitionerLineageKey: state.practitioner.lineageKey,
    }),
  };
}

function findChoiceByLineageKey<T extends { lineageKey: string }>(
  choices: readonly T[],
  lineageKey: string,
): null | T {
  return choices.find((choice) => choice.lineageKey === lineageKey) ?? null;
}

function formatSlot(slot: TelefonkiSlot): string {
  const formattedStart = formatTelefonkiDateTime(slot.startTime);
  return `${formattedStart} Uhr bei ${slot.practitionerName}`;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function invalidateOffersForCriteriaChange(
  state: CallState,
  callId: string,
  details: Record<string, number | string | undefined> = {},
): void {
  advanceSearchVersion(state.activeOffers);
  logTelefonkiEvent({
    callId,
    details: {
      ...details,
      reason: "criteria_changed",
      searchVersion: state.activeOffers.searchVersion,
    },
    event: "telefonki.offer_invalidated",
    phoneBookingIdentityId: state.phoneBookingIdentityId,
  });
}

function isRecoverableBookingAvailabilityError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "Selected slot is no longer available." ||
    error.message === "Der gewaehlte Zeitraum ist bereits belegt."
  );
}

function loadDotenv(): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, "../../.env.local"),
    path.resolve(currentDir, "../../.env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
  }
}

function logTelefonkiEvent(args: {
  callId: string;
  details?: Record<string, number | string | undefined>;
  event: string;
  phoneBookingIdentityId: Id<"phoneBookingIdentities"> | undefined;
}): void {
  console.log(
    JSON.stringify({
      callId: args.callId,
      details: args.details,
      event: args.event,
      phoneBookingIdentityId: args.phoneBookingIdentityId,
    }),
  );
}

async function markAsyncBoundary(): Promise<void> {
  await Promise.resolve();
}

function renderAndLogOfferedSlots(args: {
  callId: string;
  criteria: ReturnType<typeof buildTelefonkiOfferCriteria>;
  phoneBookingIdentityId: Id<"phoneBookingIdentities"> | undefined;
  slots: readonly TelefonkiSlot[];
  state: CallState;
}): string {
  const response = renderOfferedSlots({
    activeOffers: args.state.activeOffers,
    criteria: args.criteria,
    formatSlot,
    slots: args.slots,
  });
  logTelefonkiEvent({
    callId: args.callId,
    details: {
      count: args.slots.length,
      searchVersion: args.state.activeOffers.searchVersion,
    },
    event: "telefonki.offers_generated",
    phoneBookingIdentityId: args.phoneBookingIdentityId,
  });
  return response;
}

loadDotenv();

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const convexUrl = getOptionalEnv("CONVEX_URL") ?? getEnv("VITE_CONVEX_URL");
    const integrationSecret = getOptionalEnv("TELEFONKI_SHARED_SECRET");
    const convex = new ConvexHttpClient(convexUrl);
    const state: CallState = {
      activeOffers: {
        generatedAt: undefined,
        offers: new Map(),
        searchVersion: 0,
      },
      bookingIntent: {},
    };
    let session: undefined | voice.AgentSession;

    try {
      await ctx.connect();
      const participant = await ctx.waitForParticipant();
      const routing = resolveCallRouting(participant, ctx.job.metadata);
      if (!routing.dialedPracticePhoneNumber) {
        throw new Error(
          "Inbound call is missing sip.trunkPhoneNumber and cannot be routed to a practice.",
        );
      }

      const practiceResolution = await convex.query(
        convexApi.telefonki.resolvePracticeByDialedPhoneNumber,
        {
          dialedPracticePhoneNumber: routing.dialedPracticePhoneNumber,
          ...(integrationSecret && { integrationSecret }),
        },
      );
      const practiceId = practiceResolution.practiceId;
      const activeConfig = await convex.query(
        convexApi.telefonki.getActiveConfig,
        {
          ...(integrationSecret && { integrationSecret }),
          practiceId,
        },
      );
      const instructions = buildTelefonkiInstructions(activeConfig);

      if (routing.callerPhoneNumber) {
        state.bookingIntent.phoneNumber = routing.callerPhoneNumber;
      }
      state.phoneBookingIdentityId = await convex.mutation(
        convexApi.telefonki.createOrReusePhoneBookingIdentity,
        {
          callId: ctx.job.id,
          ...(routing.callerPhoneNumber && {
            callerPhoneNumber: routing.callerPhoneNumber,
          }),
          dialedPracticePhoneNumber: routing.dialedPracticePhoneNumber,
          ...(integrationSecret && { integrationSecret }),
          integrationActor: DEFAULT_INTEGRATION_ACTOR,
          practiceId,
        },
      );

      const tools = {
        behandlerin_speichern: llm.tool({
          description:
            "Speichert die Behandler-Lineage-ID aus der dynamischen Konfiguration. Nur aufrufen, wenn der Patient eine Behandlerin oder einen Behandler genannt hat.",
          execute: async ({ practitionerLineageKey }) => {
            await markAsyncBoundary();
            const practitioner = findChoiceByLineageKey(
              activeConfig.practitioners,
              practitionerLineageKey,
            );
            if (!practitioner) {
              return "Fehler: Diese Behandler-ID ist in der aktuellen Konfiguration nicht vorhanden.";
            }
            state.bookingIntent.practitioner = practitioner;
            invalidateOffersForCriteriaChange(state, ctx.job.id, {
              practitionerLineageKey: practitioner.lineageKey,
            });
            return `Gespeichert: ${practitioner.name}.`;
          },
          parameters: z.object({
            practitionerLineageKey: z
              .string()
              .describe(
                "Die Behandler-Lineage-ID aus der Konfigurationsliste.",
              ),
          }),
        }),
        geburtsdatum_speichern: llm.tool({
          description: "Speichert das Geburtsdatum im ISO-Format JJJJ-MM-TT.",
          execute: async ({ birthDate }) => {
            await markAsyncBoundary();
            const parsed = z.iso.date().safeParse(birthDate);
            if (!parsed.success) {
              return "Fehler: Bitte speichern Sie das Geburtsdatum im Format JJJJ-MM-TT.";
            }
            state.bookingIntent.birthDate = parsed.data;
            invalidateOffersForCriteriaChange(state, ctx.job.id);
            return `Gespeichert: ${formatTelefonkiDate(parsed.data)}.`;
          },
          parameters: z.object({
            birthDate: z
              .string()
              .describe("Geburtsdatum im Format JJJJ-MM-TT."),
          }),
        }),
        grund_speichern: llm.tool({
          description: "Speichert den kurzen Termingrund.",
          execute: async ({ reason }) => {
            await markAsyncBoundary();
            const trimmedReason = reason.trim();
            if (trimmedReason.length === 0) {
              return "Fehler: Der Termingrund darf nicht leer sein.";
            }
            state.bookingIntent.reason = trimmedReason;
            return `Gespeichert: ${trimmedReason}.`;
          },
          parameters: z.object({
            reason: z.string().describe("Ein kurzer Termingrund."),
          }),
        }),
        konfiguration_anzeigen: llm.tool({
          description:
            "Zeigt die aktuell konfigurierten Standorte, Behandler und Terminarten mit Lineage-IDs.",
          execute: async () => {
            await markAsyncBoundary();
            return instructions;
          },
        }),
        nachmittags_termin_suchen: llm.tool({
          description: "Sucht den nächsten freien Termin ab 12:00 Uhr.",
          execute: async () => {
            const missing = requireBookingPrerequisites(state);
            if (missing.length > 0) {
              return `Bitte zuerst speichern: ${missing.join(", ")}.`;
            }
            const slot = await convex.query(
              convexApi.telefonki.nextAvailableAfternoonSlot,
              {
                ...(integrationSecret && { integrationSecret }),
                practiceId,
                simulatedContext: buildSimulatedContext(state.bookingIntent),
              },
            );
            return renderAndLogOfferedSlots({
              callId: ctx.job.id,
              criteria: buildCurrentOfferCriteria(state.bookingIntent),
              phoneBookingIdentityId: state.phoneBookingIdentityId,
              slots: slot ? [slot] : [],
              state,
            });
          },
        }),
        nachmittags_zehn_termine_suchen: llm.tool({
          description: "Sucht bis zu zehn freie Termine ab 12:00 Uhr.",
          execute: async () => {
            const missing = requireBookingPrerequisites(state);
            if (missing.length > 0) {
              return `Bitte zuerst speichern: ${missing.join(", ")}.`;
            }
            const slots = await convex.query(
              convexApi.telefonki.nextAvailableAfternoonSlots,
              {
                ...(integrationSecret && { integrationSecret }),
                limit: 10,
                practiceId,
                simulatedContext: buildSimulatedContext(state.bookingIntent),
              },
            );
            return renderAndLogOfferedSlots({
              callId: ctx.job.id,
              criteria: buildCurrentOfferCriteria(state.bookingIntent),
              phoneBookingIdentityId: state.phoneBookingIdentityId,
              slots,
              state,
            });
          },
        }),
        naechste_zehn_termine_suchen: llm.tool({
          description: "Sucht bis zu zehn nächste freie Termine.",
          execute: async () => {
            const missing = requireBookingPrerequisites(state);
            if (missing.length > 0) {
              return `Bitte zuerst speichern: ${missing.join(", ")}.`;
            }
            const slots = await convex.query(
              convexApi.telefonki.nextAvailableSlots,
              {
                ...(integrationSecret && { integrationSecret }),
                limit: 10,
                practiceId,
                simulatedContext: buildSimulatedContext(state.bookingIntent),
              },
            );
            return renderAndLogOfferedSlots({
              callId: ctx.job.id,
              criteria: buildCurrentOfferCriteria(state.bookingIntent),
              phoneBookingIdentityId: state.phoneBookingIdentityId,
              slots,
              state,
            });
          },
        }),
        naechsten_termin_suchen: llm.tool({
          description: "Sucht den nächsten freien Termin.",
          execute: async () => {
            const missing = requireBookingPrerequisites(state);
            if (missing.length > 0) {
              return `Bitte zuerst speichern: ${missing.join(", ")}.`;
            }
            const slot = await convex.query(
              convexApi.telefonki.nextAvailableSlot,
              {
                ...(integrationSecret && { integrationSecret }),
                practiceId,
                simulatedContext: buildSimulatedContext(state.bookingIntent),
              },
            );
            return renderAndLogOfferedSlots({
              callId: ctx.job.id,
              criteria: buildCurrentOfferCriteria(state.bookingIntent),
              phoneBookingIdentityId: state.phoneBookingIdentityId,
              slots: slot ? [slot] : [],
              state,
            });
          },
        }),
        patient_status_speichern: llm.tool({
          description:
            "Speichert, ob der Patient neu ist. true bedeutet noch nie in der Praxis; false bedeutet bereits bekannt.",
          execute: async ({ isNewPatient }) => {
            await markAsyncBoundary();
            state.bookingIntent.isNewPatient = isNewPatient;
            invalidateOffersForCriteriaChange(state, ctx.job.id);
            return isNewPatient
              ? "Patient ist neu."
              : "Patient ist bereits bekannt.";
          },
          parameters: z.object({
            isNewPatient: z
              .boolean()
              .describe("true = neuer Patient; false = war schon einmal da."),
          }),
        }),
        personenbezogene_daten_speichern: llm.tool({
          description: "Speichert Vorname und Nachname des Patienten.",
          execute: async ({ firstName, lastName }) => {
            await markAsyncBoundary();
            const trimmedFirstName = firstName.trim();
            const trimmedLastName = lastName.trim();
            if (trimmedFirstName.length === 0 || trimmedLastName.length === 0) {
              return "Fehler: Vorname und Nachname dürfen nicht leer sein.";
            }
            state.bookingIntent.firstName = trimmedFirstName;
            state.bookingIntent.lastName = trimmedLastName;
            return "Name ist gespeichert.";
          },
          parameters: z.object({
            firstName: z.string().describe("Vorname des Patienten."),
            lastName: z.string().describe("Nachname des Patienten."),
          }),
        }),
        standort_speichern: llm.tool({
          description:
            "Speichert die Standort-Lineage-ID aus der dynamischen Konfiguration.",
          execute: async ({ locationLineageKey }) => {
            await markAsyncBoundary();
            const location = findChoiceByLineageKey(
              activeConfig.locations,
              locationLineageKey,
            );
            if (!location) {
              return "Fehler: Diese Standort-ID ist in der aktuellen Konfiguration nicht vorhanden.";
            }
            state.bookingIntent.location = location;
            invalidateOffersForCriteriaChange(state, ctx.job.id, {
              locationLineageKey: location.lineageKey,
            });
            return `Gespeichert: ${location.name}.`;
          },
          parameters: z.object({
            locationLineageKey: z
              .string()
              .describe("Die Standort-Lineage-ID aus der Konfigurationsliste."),
          }),
        }),
        telefonnummer_speichern: llm.tool({
          description:
            "Speichert die Telefonnummer des Patienten. Verwenden Sie diese Funktion besonders dann, wenn keine Anrufernummer vorliegt.",
          execute: async ({ phoneNumber }) => {
            await markAsyncBoundary();
            try {
              state.bookingIntent.phoneNumber =
                sanitizePhoneNumber(phoneNumber);
            } catch (error) {
              if (error instanceof Error) {
                return `Fehler: ${error.message}`;
              }
              return "Fehler: Telefonnummer konnte nicht gespeichert werden.";
            }
            return `Telefonnummer gespeichert: ${state.bookingIntent.phoneNumber}.`;
          },
          parameters: z.object({
            phoneNumber: z.string().describe("Telefonnummer des Patienten."),
          }),
        }),
        termin_anzeigen: llm.tool({
          description:
            "Zeigt ausschließlich den Termin an, der in diesem Anruf gebucht wurde.",
          execute: async () => {
            if (!state.phoneBookingIdentityId) {
              return "Es gibt in diesem Anruf noch keinen gebuchten Termin.";
            }
            const appointment = await convex.query(
              convexApi.telefonki.viewBookedAppointment,
              {
                ...(integrationSecret && { integrationSecret }),
                phoneBookingIdentityId: state.phoneBookingIdentityId,
              },
            );
            if (!appointment) {
              return "Es gibt in diesem Anruf keinen sichtbaren gebuchten Termin.";
            }
            return `Gebuchter Termin: ${formatTelefonkiDateTime(appointment.start)} Uhr, ${appointment.appointmentTypeTitle}.`;
          },
        }),
        termin_buchen: llm.tool({
          description:
            "Bucht einen zuvor angebotenen Termin. Nur mit einer offerId aus einer Suchfunktion aufrufen.",
          execute: async ({ offerId }) => {
            if (!state.phoneBookingIdentityId) {
              return "Fehler: Die Telefonidentität wurde noch nicht angelegt.";
            }

            const missing = requireBookingPrerequisites(state);
            if (missing.length > 0) {
              return `Bitte zuerst speichern: ${missing.join(", ")}.`;
            }

            const storedOffer = state.activeOffers.offers.get(offerId);
            if (!storedOffer) {
              return "Fehler: Dieser Termin wurde in diesem Gespräch nicht angeboten. Bitte suchen Sie erneut.";
            }

            if (
              !state.bookingIntent.appointmentType ||
              !state.bookingIntent.location ||
              !state.bookingIntent.firstName ||
              !state.bookingIntent.lastName ||
              state.bookingIntent.isNewPatient === undefined
            ) {
              return "Fehler: Es fehlen gespeicherte Pflichtdaten.";
            }

            const currentCriteria = buildCurrentOfferCriteria(
              state.bookingIntent,
            );
            const invalidationReason = isStoredOfferCompatible({
              activeOffers: state.activeOffers,
              currentCriteria,
              storedOffer,
            });
            if (invalidationReason) {
              clearOfferedSlots(state.activeOffers);
              logTelefonkiEvent({
                callId: ctx.job.id,
                details: {
                  offerId,
                  reason: invalidationReason,
                  searchVersion: state.activeOffers.searchVersion,
                },
                event: "telefonki.offer_invalidated",
                phoneBookingIdentityId: state.phoneBookingIdentityId,
              });
              if (invalidationReason === "expired") {
                return "Fehler: Das Terminangebot ist abgelaufen. Bitte suchen Sie erneut.";
              }
              return "Fehler: Die angebotenen Termine passen nicht mehr zum aktuellen Suchstand. Bitte suchen Sie erneut.";
            }

            const slot = storedOffer.slot;

            try {
              const booking = await convex.mutation(convexApi.telefonki.book, {
                appointmentTypeLineageKey:
                  state.bookingIntent.appointmentType.lineageKey,
                ...(integrationSecret && { integrationSecret }),
                locationLineageKey: state.bookingIntent.location.lineageKey,
                patient: {
                  ...(state.bookingIntent.birthDate && {
                    dateOfBirth: state.bookingIntent.birthDate,
                  }),
                  firstName: state.bookingIntent.firstName,
                  isNew: state.bookingIntent.isNewPatient,
                  lastName: state.bookingIntent.lastName,
                  ...(state.bookingIntent.phoneNumber && {
                    phoneNumber: state.bookingIntent.phoneNumber,
                  }),
                },
                phoneBookingIdentityId: state.phoneBookingIdentityId,
                practitionerLineageKey: slot.practitionerLineageKey,
                practitionerName: slot.practitionerName,
                reasonDescription: state.bookingIntent.reason ?? "",
                startTime: slot.startTime,
              });

              clearOfferedSlots(state.activeOffers);
              logTelefonkiEvent({
                callId: ctx.job.id,
                details: {
                  offerId,
                  reason: "booked",
                  searchVersion: state.activeOffers.searchVersion,
                },
                event: "telefonki.offer_invalidated",
                phoneBookingIdentityId: state.phoneBookingIdentityId,
              });
              return `Der Termin wurde gebucht: ${formatSlot(slot)}. Termin-ID: ${booking.appointmentId}.`;
            } catch (error) {
              logTelefonkiEvent({
                callId: ctx.job.id,
                details: {
                  error:
                    error instanceof Error ? error.message : "unknown_error",
                  offerId,
                },
                event: "telefonki.booking_rejected",
                phoneBookingIdentityId: state.phoneBookingIdentityId,
              });

              if (!isRecoverableBookingAvailabilityError(error)) {
                if (error instanceof Error) {
                  return `Fehler: ${error.message}`;
                }
                return "Fehler: Termin konnte nicht gebucht werden.";
              }

              clearOfferedSlots(state.activeOffers);
              const alternativeSlot = await convex.query(
                convexApi.telefonki.nextAvailableSlot,
                {
                  ...(integrationSecret && { integrationSecret }),
                  practiceId,
                  simulatedContext: buildSimulatedContext(state.bookingIntent),
                },
              );
              const alternativeResponse = renderAndLogOfferedSlots({
                callId: ctx.job.id,
                criteria: buildCurrentOfferCriteria(state.bookingIntent),
                phoneBookingIdentityId: state.phoneBookingIdentityId,
                slots: alternativeSlot ? [alternativeSlot] : [],
                state,
              });
              logTelefonkiEvent({
                callId: ctx.job.id,
                details: {
                  recovered: alternativeSlot ? 1 : 0,
                  searchVersion: state.activeOffers.searchVersion,
                },
                event: "telefonki.booking_recovery_search",
                phoneBookingIdentityId: state.phoneBookingIdentityId,
              });
              return `Der bestätigte Termin ist nicht mehr frei. ${alternativeResponse}`;
            }
          },
          parameters: z.object({
            offerId: z
              .string()
              .describe("Die offerId eines zuvor angebotenen Termins."),
          }),
        }),
        termin_stornieren: llm.tool({
          description:
            "Storniert ausschließlich den Termin, der in diesem Anruf gebucht wurde.",
          execute: async () => {
            if (!state.phoneBookingIdentityId) {
              return "Es gibt in diesem Anruf keinen gebuchten Termin.";
            }
            const appointment = await convex.mutation(
              convexApi.telefonki.cancelBookedAppointment,
              {
                ...(integrationSecret && { integrationSecret }),
                phoneBookingIdentityId: state.phoneBookingIdentityId,
              },
            );
            if (!appointment) {
              return "Es gibt in diesem Anruf keinen stornierbaren Termin.";
            }
            return "Der in diesem Anruf gebuchte Termin wurde storniert.";
          },
        }),
        terminart_speichern: llm.tool({
          description:
            "Speichert die Terminart-Lineage-ID aus der dynamischen Konfiguration.",
          execute: async ({ appointmentTypeLineageKey }) => {
            await markAsyncBoundary();
            const appointmentType = findChoiceByLineageKey(
              activeConfig.appointmentTypes,
              appointmentTypeLineageKey,
            );
            if (!appointmentType) {
              return "Fehler: Diese Terminart-ID ist in der aktuellen Konfiguration nicht vorhanden.";
            }
            state.bookingIntent.appointmentType = appointmentType;
            invalidateOffersForCriteriaChange(state, ctx.job.id, {
              appointmentTypeLineageKey: appointmentType.lineageKey,
            });
            return `Gespeichert: ${appointmentType.name}.`;
          },
          parameters: z.object({
            appointmentTypeLineageKey: z
              .string()
              .describe(
                "Die Terminart-Lineage-ID aus der Konfigurationsliste.",
              ),
          }),
        }),
        termine_am_datum_suchen: llm.tool({
          description:
            "Sucht bis zu zehn freie Termine an einem konkreten Datum im Format JJJJ-MM-TT.",
          execute: async ({ date }) => {
            const parsed = z.iso.date().safeParse(date);
            if (!parsed.success) {
              return "Fehler: Bitte geben Sie das Datum im Format JJJJ-MM-TT an.";
            }
            const missing = requireBookingPrerequisites(state);
            if (missing.length > 0) {
              return `Bitte zuerst speichern: ${missing.join(", ")}.`;
            }
            const slots = await convex.query(
              convexApi.telefonki.availableSlotsOnDate,
              {
                date: parsed.data,
                ...(integrationSecret && { integrationSecret }),
                limit: 10,
                practiceId,
                simulatedContext: buildSimulatedContext(state.bookingIntent),
              },
            );
            return renderAndLogOfferedSlots({
              callId: ctx.job.id,
              criteria: buildCurrentOfferCriteria(state.bookingIntent),
              phoneBookingIdentityId: state.phoneBookingIdentityId,
              slots,
              state,
            });
          },
          parameters: z.object({
            date: z.string().describe("Datum im Format JJJJ-MM-TT."),
          }),
        }),
      } as const;

      const agent = new voice.Agent({
        instructions,
        tools,
      });

      session = new voice.AgentSession({
        llm: new openai.realtime.RealtimeModel({
          inputAudioTranscription: null,
          model:
            getOptionalEnv("TELEFONKI_REALTIME_MODEL") ?? "gpt-realtime-1.5",
          turnDetection: {
            create_response: true,
            interrupt_response: true,
            prefix_padding_ms: 300,
            silence_duration_ms: 350,
            threshold: 0.4,
            type: "server_vad",
          },
          voice: getOptionalEnv("TELEFONKI_REALTIME_VOICE") ?? "echo",
        }),
      });

      await session.start({
        agent,
        inputOptions: {
          closeOnDisconnect: false,
        },
        room: ctx.room,
      });

      session.generateReply({
        instructions:
          "Begrüßen Sie den Anrufer kurz und beginnen Sie mit der Frage, ob er schon einmal in der Praxis war.",
      });

      const activeSession = session;
      await new Promise<void>((resolve) => {
        let settled = false;

        const cleanup = () => {
          ctx.room.off(RoomEvent.Disconnected, handleDisconnect);
          activeSession.off(
            voice.AgentSessionEventTypes.Close,
            handleSessionClose,
          );
        };

        const settle = () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve();
        };

        const handleDisconnect = () => {
          settle();
        };

        const handleSessionClose = () => {
          settle();
        };

        ctx.room.on(RoomEvent.Disconnected, handleDisconnect);
        activeSession.on(
          voice.AgentSessionEventTypes.Close,
          handleSessionClose,
        );
      });
    } finally {
      await session?.close();
    }
  },
});

function requireBookingPrerequisites(state: CallState): string[] {
  return listMissingBookingPrerequisites(state.bookingIntent);
}

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: AGENT_NAME,
  }),
);

import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { regex } from "../lib/arkregex.js";
import { getAppointmentPractitionerLineageKey } from "./appointmentOccupancy";

type Reader = GenericDatabaseReader<DataModel>;
type Writer = GenericDatabaseWriter<DataModel>;

const LOW_SIGNAL_APPOINTMENT_TYPE_NAMES = new Set(["erkaltung", "magen-darm"]);
const DIACRITIC_REGEX = regex.as(String.raw`\p{Diacritic}`, "gu");

export interface PractitionerAssociationEvidence {
  legacyAppointmentId?: string;
  legacyIdentityId?: string;
  legacyPractitionerName?: string;
  matchedAppointmentCount?: number;
  sourceSessionKey?: string;
}

export type PractitionerAssociationSource =
  | "appointment-history"
  | "legacy-baumdiagramm"
  | "manual";

export function assertPractitionerAssociationSubject(args: {
  bookingIdentityId?: Id<"bookingIdentities">;
  patientId?: Id<"patients">;
}) {
  if (args.bookingIdentityId === undefined && args.patientId === undefined) {
    throw new Error(
      "Practitioner association requires a patient or booking identity.",
    );
  }
}

export async function attachPatientToBookingIdentityPractitionerAssociations(
  db: Writer,
  args: {
    bookingIdentityId: Id<"bookingIdentities">;
    now: bigint;
    patientId: Id<"patients">;
    practiceId: Id<"practices">;
  },
): Promise<number> {
  const rows = await db
    .query("practitionerAssociations")
    .withIndex("by_bookingIdentityId", (q) =>
      q.eq("bookingIdentityId", args.bookingIdentityId),
    )
    .collect();

  let patched = 0;
  for (const row of rows) {
    if (
      row.practiceId !== args.practiceId ||
      row.patientId === args.patientId
    ) {
      continue;
    }
    await db.patch("practitionerAssociations", row._id, {
      lastModified: args.now,
      patientId: args.patientId,
    });
    patched += 1;
  }
  return patched;
}

export async function derivePractitionerAssociationFromAppointmentHistory(
  db: Reader,
  args: {
    patientId: Id<"patients">;
    practiceId: Id<"practices">;
  },
): Promise<null | {
  appointmentCount: number;
  practitionerLineageKey: Id<"practitioners">;
}> {
  const patientAppointments = await db
    .query("appointments")
    .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
    .collect();
  const appointments = patientAppointments.filter(
    (appointment) =>
      appointment.practiceId === args.practiceId &&
      appointment.isSimulation !== true &&
      appointment.cancelledAt === undefined &&
      !isLowSignalAppointmentType(appointment.appointmentTypeTitle),
  );

  const counts = new Map<Id<"practitioners">, number>();
  for (const appointment of appointments) {
    const practitionerLineageKey = getAppointmentPractitionerLineageKey(
      appointment.occupancyScope,
    );
    if (practitionerLineageKey === undefined) {
      continue;
    }
    counts.set(
      practitionerLineageKey,
      (counts.get(practitionerLineageKey) ?? 0) + 1,
    );
  }

  const ranked = [...counts.entries()].toSorted((left, right) => {
    if (left[1] !== right[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
  const [best, second] = ranked;
  if (best === undefined || best[1] === second?.[1]) {
    return null;
  }

  return {
    appointmentCount: best[1],
    practitionerLineageKey: best[0],
  };
}

export async function resolvePreferredPractitionerAssociation(
  db: Reader,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"practitionerAssociations"> | null> {
  if (args.patientId !== undefined) {
    const patientRows = await db
      .query("practitionerAssociations")
      .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
      .collect();
    const patientAssociation = latestAssociation(
      patientRows.filter((row) => row.practiceId === args.practiceId),
    );
    if (patientAssociation !== null) {
      return patientAssociation;
    }
  }

  if (args.bookingIdentityId === undefined) {
    return null;
  }

  const bookingIdentityRows = await db
    .query("practitionerAssociations")
    .withIndex("by_bookingIdentityId", (q) =>
      q.eq("bookingIdentityId", args.bookingIdentityId),
    )
    .collect();
  return latestAssociation(
    bookingIdentityRows.filter((row) => row.practiceId === args.practiceId),
  );
}

export async function upsertAppointmentHistoryPractitionerAssociation(
  db: Writer,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    now: bigint;
    patientId: Id<"patients">;
    practiceId: Id<"practices">;
  },
): Promise<
  | {
      associationId: Id<"practitionerAssociations">;
      kind: "associated";
    }
  | { kind: "no_clear_winner" }
> {
  const guess = await derivePractitionerAssociationFromAppointmentHistory(db, {
    patientId: args.patientId,
    practiceId: args.practiceId,
  });

  if (guess === null) {
    return { kind: "no_clear_winner" };
  }

  const associationId = await upsertPractitionerAssociation(db, {
    ...(args.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: args.bookingIdentityId }),
    evidence: { matchedAppointmentCount: guess.appointmentCount },
    now: args.now,
    patientId: args.patientId,
    practiceId: args.practiceId,
    practitionerLineageKey: guess.practitionerLineageKey,
    source: "appointment-history",
  });

  return { associationId, kind: "associated" };
}

export async function upsertPractitionerAssociation(
  db: Writer,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    evidence?: PractitionerAssociationEvidence;
    now: bigint;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerLineageKey: Id<"practitioners">;
    source: PractitionerAssociationSource;
  },
): Promise<Id<"practitionerAssociations">> {
  assertPractitionerAssociationSubject(args);

  const existing = await findAssociationForUpsert(db, args);
  const patch = {
    ...(args.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: args.bookingIdentityId }),
    ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
    lastModified: args.now,
    ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
    source: args.source,
  };

  if (existing !== null) {
    await db.patch("practitionerAssociations", existing._id, patch);
    return existing._id;
  }

  return await db.insert("practitionerAssociations", {
    ...(args.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: args.bookingIdentityId }),
    createdAt: args.now,
    ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
    lastModified: args.now,
    ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
    practiceId: args.practiceId,
    practitionerLineageKey: args.practitionerLineageKey,
    source: args.source,
  });
}

async function findAssociationForUpsert(
  db: Reader,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerLineageKey: Id<"practitioners">;
  },
): Promise<Doc<"practitionerAssociations"> | null> {
  if (args.patientId !== undefined) {
    const patientMatches = await db
      .query("practitionerAssociations")
      .withIndex("by_patientId_practitionerLineageKey", (q) =>
        q
          .eq("patientId", args.patientId)
          .eq("practitionerLineageKey", args.practitionerLineageKey),
      )
      .collect();
    const patientMatch = latestAssociation(
      patientMatches.filter((row) => row.practiceId === args.practiceId),
    );
    if (patientMatch !== null) {
      return patientMatch;
    }
  }

  if (args.bookingIdentityId === undefined) {
    return null;
  }

  const bookingIdentityMatches = await db
    .query("practitionerAssociations")
    .withIndex("by_bookingIdentityId_practitionerLineageKey", (q) =>
      q
        .eq("bookingIdentityId", args.bookingIdentityId)
        .eq("practitionerLineageKey", args.practitionerLineageKey),
    )
    .collect();
  return latestAssociation(
    bookingIdentityMatches.filter((row) => row.practiceId === args.practiceId),
  );
}

function isLowSignalAppointmentType(appointmentTypeTitle: string): boolean {
  const normalized = appointmentTypeTitle
    .trim()
    .normalize("NFD")
    .replaceAll(DIACRITIC_REGEX, "")
    .toLocaleLowerCase();
  return LOW_SIGNAL_APPOINTMENT_TYPE_NAMES.has(normalized);
}

function latestAssociation(
  rows: Doc<"practitionerAssociations">[],
): Doc<"practitionerAssociations"> | null {
  return (
    rows.toSorted((left, right) => {
      if (left.lastModified !== right.lastModified) {
        return Number(right.lastModified - left.lastModified);
      }
      return right._id.localeCompare(left._id);
    })[0] ?? null
  );
}

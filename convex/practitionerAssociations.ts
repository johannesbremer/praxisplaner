import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { v } from "convex/values";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

import { regex } from "../lib/arkregex.js";
import { mutation, query } from "./_generated/server";
import { getAppointmentPractitionerLineageKey } from "./appointmentOccupancy";
import {
  ensureRuleSetAccessForMutation,
  requirePracticeStaff,
  requirePracticeStaffForMutation,
} from "./practiceAccess";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import {
  ensureAuthenticatedIdentity,
  ensureAuthenticatedUserId,
} from "./userIdentity";

type Reader = GenericDatabaseReader<DataModel>;
type Writer = GenericDatabaseWriter<DataModel>;

const LOW_SIGNAL_APPOINTMENT_TYPE_NAMES = new Set(["erkaltung", "magen-darm"]);
const DIACRITIC_REGEX = regex.as(String.raw`\p{Diacritic}`, "gu");

export type PractitionerAssociationPrecedencePolicy = "import" | "runtime";

export type PractitionerAssociationSource =
  | "appointment-history"
  | "legacy-baumdiagramm"
  | "manual";

export type PractitionerAssociationStatus =
  | "active"
  | "rejected"
  | "superseded";

const practitionerAssociationSummaryValidator = v.object({
  _id: v.id("practitionerAssociations"),
  practitionerLineageKey: v.id("practitioners"),
  source: v.union(
    v.literal("legacy-baumdiagramm"),
    v.literal("appointment-history"),
    v.literal("manual"),
  ),
});

export const getPreferredPractitionerAssociationForPatient = query({
  args: {
    patientId: v.id("patients"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    const patient = await ctx.db.get("patients", args.patientId);
    if (patient?.practiceId !== args.practiceId) {
      return null;
    }

    const association = await resolvePreferredPractitionerAssociation(ctx.db, {
      ...(patient.bookingIdentityId === undefined
        ? {}
        : { bookingIdentityId: patient.bookingIdentityId }),
      patientId: args.patientId,
      practiceId: args.practiceId,
    });
    if (association === null) {
      return null;
    }

    return {
      _id: association._id,
      practitionerLineageKey: association.practitionerLineageKey,
      source: association.source,
    };
  },
  returns: v.union(v.null(), practitionerAssociationSummaryValidator),
});

export const setManualPractitionerAssociationForPatient = mutation({
  args: {
    patientId: v.id("patients"),
    practiceId: v.id("practices"),
    practitionerLineageKey: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaffForMutation(ctx, args.practiceId);
    const ruleSetPracticeId = await ensureRuleSetAccessForMutation(
      ctx,
      args.ruleSetId,
    );
    if (ruleSetPracticeId !== args.practiceId) {
      throw new Error("Rule set does not belong to this practice.");
    }
    const userId = await ensureAuthenticatedUserId(ctx);
    const patient = await ctx.db.get("patients", args.patientId);
    if (patient?.practiceId !== args.practiceId) {
      throw new Error("Patient does not belong to this practice.");
    }
    await requireActivePractitionerLineageInRuleSet(ctx.db, {
      practiceId: args.practiceId,
      practitionerLineageKey: args.practitionerLineageKey,
      ruleSetId: args.ruleSetId,
    });

    return await setPractitionerAssociation(ctx.db, {
      ...(patient.bookingIdentityId === undefined
        ? {}
        : { bookingIdentityId: patient.bookingIdentityId }),
      createdByUserId: userId,
      now: BigInt(Date.now()),
      patientId: args.patientId,
      practiceId: args.practiceId,
      practitionerLineageKey: args.practitionerLineageKey,
      precedencePolicy: "runtime",
      source: "manual",
    });
  },
  returns: v.object({
    associationId: v.id("practitionerAssociations"),
    kind: v.union(
      v.literal("associated"),
      v.literal("rejected"),
      v.literal("unchanged"),
    ),
  }),
});

export async function applyAppointmentHistoryPractitionerAssociation(
  db: Writer,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    createdByUserId?: Id<"users">;
    now: bigint;
    patientId: Id<"patients">;
    practiceId: Id<"practices">;
    precedencePolicy: PractitionerAssociationPrecedencePolicy;
  },
): Promise<
  | {
      associationId: Id<"practitionerAssociations">;
      kind: "associated" | "rejected" | "unchanged";
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

  return await setPractitionerAssociation(db, {
    ...(args.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: args.bookingIdentityId }),
    ...(args.createdByUserId === undefined
      ? {}
      : { createdByUserId: args.createdByUserId }),
    now: args.now,
    patientId: args.patientId,
    practiceId: args.practiceId,
    practitionerLineageKey: guess.practitionerLineageKey,
    precedencePolicy: args.precedencePolicy,
    source: "appointment-history",
  });
}

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

export async function canonicalizeBookingIdentityPractitionerAssociations(
  db: Writer,
  args: {
    bookingIdentityId: Id<"bookingIdentities">;
    now: bigint;
    patientId: Id<"patients">;
    practiceId: Id<"practices">;
    precedencePolicy: PractitionerAssociationPrecedencePolicy;
    userId?: Id<"users">;
  },
): Promise<number> {
  const activeBookingIdentityRows = await listActiveBookingIdentityAssociations(
    db,
    {
      bookingIdentityId: args.bookingIdentityId,
      practiceId: args.practiceId,
    },
  );

  let superseded = 0;
  for (const row of activeBookingIdentityRows) {
    if (row.patientId === args.patientId) {
      continue;
    }

    await setPractitionerAssociation(db, {
      bookingIdentityId: args.bookingIdentityId,
      ...(args.userId === undefined ? {} : { createdByUserId: args.userId }),
      now: args.now,
      patientId: args.patientId,
      practiceId: args.practiceId,
      practitionerLineageKey: row.practitionerLineageKey,
      precedencePolicy: args.precedencePolicy,
      source: row.source,
    });
    await supersedePractitionerAssociation(db, {
      now: args.now,
      row,
      ...(args.userId === undefined ? {} : { userId: args.userId }),
    });
    superseded += 1;
  }

  return superseded;
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
    const patientAssociation = latestAssociation(
      await listActivePatientAssociations(db, {
        patientId: args.patientId,
        practiceId: args.practiceId,
      }),
    );
    if (patientAssociation !== null) {
      return patientAssociation;
    }
  }

  if (args.bookingIdentityId === undefined) {
    return null;
  }

  return latestAssociation(
    await listActiveBookingIdentityAssociations(db, {
      bookingIdentityId: args.bookingIdentityId,
      practiceId: args.practiceId,
    }),
  );
}

export async function setPractitionerAssociation(
  db: Writer,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    createdByUserId?: Id<"users">;
    now: bigint;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerLineageKey: Id<"practitioners">;
    precedencePolicy: PractitionerAssociationPrecedencePolicy;
    source: PractitionerAssociationSource;
  },
): Promise<{
  associationId: Id<"practitionerAssociations">;
  kind: "associated" | "rejected" | "unchanged";
}> {
  const resolvedPatientId =
    args.patientId ??
    (args.bookingIdentityId === undefined
      ? undefined
      : await resolveAssociatedPatientIdForBookingIdentity(
          db,
          args.bookingIdentityId,
        ));
  assertPractitionerAssociationSubject({
    ...(args.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: args.bookingIdentityId }),
    ...(resolvedPatientId === undefined
      ? {}
      : { patientId: resolvedPatientId }),
  });

  const current = await resolveAuthoritativePractitionerAssociationForWrite(
    db,
    {
      ...args,
      ...(resolvedPatientId === undefined
        ? {}
        : { patientId: resolvedPatientId }),
    },
  );
  if (
    current?.practitionerLineageKey === args.practitionerLineageKey &&
    (resolvedPatientId === undefined || current.patientId === resolvedPatientId)
  ) {
    return { associationId: current._id, kind: "unchanged" };
  }

  if (
    current !== null &&
    !incomingSourceCanSupersede(
      current.source,
      args.source,
      args.precedencePolicy,
    )
  ) {
    const associationId = await insertPractitionerAssociation(db, {
      ...(args.bookingIdentityId === undefined
        ? {}
        : { bookingIdentityId: args.bookingIdentityId }),
      ...(args.createdByUserId === undefined
        ? {}
        : { createdByUserId: args.createdByUserId }),
      now: args.now,
      ...(resolvedPatientId === undefined
        ? {}
        : { patientId: resolvedPatientId }),
      practiceId: args.practiceId,
      practitionerLineageKey: args.practitionerLineageKey,
      source: args.source,
      status: "rejected",
    });
    return { associationId, kind: "rejected" };
  }

  await supersedeAuthoritativePractitionerAssociationsForWrite(db, {
    ...(args.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: args.bookingIdentityId }),
    now: args.now,
    ...(resolvedPatientId === undefined
      ? {}
      : { patientId: resolvedPatientId }),
    practiceId: args.practiceId,
    ...(args.createdByUserId === undefined
      ? {}
      : { userId: args.createdByUserId }),
  });
  const associationId = await insertPractitionerAssociation(db, {
    ...(args.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: args.bookingIdentityId }),
    ...(args.createdByUserId === undefined
      ? {}
      : { createdByUserId: args.createdByUserId }),
    now: args.now,
    ...(resolvedPatientId === undefined
      ? {}
      : { patientId: resolvedPatientId }),
    practiceId: args.practiceId,
    practitionerLineageKey: args.practitionerLineageKey,
    source: args.source,
    status: "active",
  });

  return { associationId, kind: "associated" };
}

function incomingSourceCanSupersede(
  currentSource: PractitionerAssociationSource,
  incomingSource: PractitionerAssociationSource,
  precedencePolicy: PractitionerAssociationPrecedencePolicy,
): boolean {
  if (currentSource === incomingSource) {
    return true;
  }

  return (
    sourcePrecedenceRank(incomingSource, precedencePolicy) >
    sourcePrecedenceRank(currentSource, precedencePolicy)
  );
}

async function insertPractitionerAssociation(
  db: Writer,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    createdByUserId?: Id<"users">;
    now: bigint;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerLineageKey: Id<"practitioners">;
    source: PractitionerAssociationSource;
    status: PractitionerAssociationStatus;
  },
): Promise<Id<"practitionerAssociations">> {
  return await db.insert("practitionerAssociations", {
    ...(args.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: args.bookingIdentityId }),
    createdAt: args.now,
    ...(args.createdByUserId === undefined
      ? {}
      : { createdByUserId: args.createdByUserId }),
    lastModified: args.now,
    ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
    practiceId: args.practiceId,
    practitionerLineageKey: args.practitionerLineageKey,
    source: args.source,
    status: args.status,
  });
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
      if (left.createdAt !== right.createdAt) {
        return Number(right.createdAt - left.createdAt);
      }
      return right._id.localeCompare(left._id);
    })[0] ?? null
  );
}

async function listActiveBookingIdentityAssociations(
  db: Reader,
  args: {
    bookingIdentityId: Id<"bookingIdentities">;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"practitionerAssociations">[]> {
  const rows = await db
    .query("practitionerAssociations")
    .withIndex("by_bookingIdentityId_status", (q) =>
      q.eq("bookingIdentityId", args.bookingIdentityId).eq("status", "active"),
    )
    .collect();
  return rows.filter((row) => row.practiceId === args.practiceId);
}

async function listActivePatientAssociations(
  db: Reader,
  args: {
    patientId: Id<"patients">;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"practitionerAssociations">[]> {
  const rows = await db
    .query("practitionerAssociations")
    .withIndex("by_patientId_status", (q) =>
      q.eq("patientId", args.patientId).eq("status", "active"),
    )
    .collect();
  return rows.filter((row) => row.practiceId === args.practiceId);
}

async function requireActivePractitionerLineageInRuleSet(
  db: Reader,
  args: {
    practiceId: Id<"practices">;
    practitionerLineageKey: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<void> {
  const practitioner = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q
        .eq("ruleSetId", args.ruleSetId)
        .eq("lineageKey", args.practitionerLineageKey),
    )
    .first();
  if (
    practitioner?.practiceId === args.practiceId &&
    !isRuleSetEntityDeleted(practitioner)
  ) {
    return;
  }

  throw new Error("Behandler nicht in diesem Regelset.");
}

async function resolveAssociatedPatientIdForBookingIdentity(
  db: Reader,
  bookingIdentityId: Id<"bookingIdentities">,
): Promise<Id<"patients"> | undefined> {
  const rows = await db
    .query("bookingIdentityPatientAssociations")
    .withIndex("by_bookingIdentityId_status", (q) =>
      q.eq("bookingIdentityId", bookingIdentityId).eq("status", "active"),
    )
    .collect();

  const latest = rows.toSorted((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return Number(right.createdAt - left.createdAt);
    }
    return right._id.localeCompare(left._id);
  })[0];

  return latest?.patientId;
}

async function resolveAuthoritativePractitionerAssociationForWrite(
  db: Reader,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
  },
): Promise<Doc<"practitionerAssociations"> | null> {
  if (args.patientId !== undefined) {
    return latestAssociation(
      await listActivePatientAssociations(db, {
        patientId: args.patientId,
        practiceId: args.practiceId,
      }),
    );
  }

  if (args.bookingIdentityId === undefined) {
    return null;
  }

  return latestAssociation(
    await listActiveBookingIdentityAssociations(db, {
      bookingIdentityId: args.bookingIdentityId,
      practiceId: args.practiceId,
    }),
  );
}

function sourcePrecedenceRank(
  source: PractitionerAssociationSource,
  precedencePolicy: PractitionerAssociationPrecedencePolicy,
): number {
  const ranks = {
    import: {
      "appointment-history": 1,
      "legacy-baumdiagramm": 2,
      manual: 3,
    },
    runtime: {
      "appointment-history": 2,
      "legacy-baumdiagramm": 1,
      manual: 3,
    },
  } satisfies Record<
    PractitionerAssociationPrecedencePolicy,
    Record<PractitionerAssociationSource, number>
  >;

  return ranks[precedencePolicy][source];
}

async function supersedeAuthoritativePractitionerAssociationsForWrite(
  db: Writer,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    now: bigint;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    userId?: Id<"users">;
  },
): Promise<number> {
  const rows =
    args.patientId === undefined
      ? args.bookingIdentityId === undefined
        ? []
        : await listActiveBookingIdentityAssociations(db, {
            bookingIdentityId: args.bookingIdentityId,
            practiceId: args.practiceId,
          })
      : await listActivePatientAssociations(db, {
          patientId: args.patientId,
          practiceId: args.practiceId,
        });

  for (const row of rows) {
    await supersedePractitionerAssociation(db, {
      now: args.now,
      row,
      ...(args.userId === undefined ? {} : { userId: args.userId }),
    });
  }
  return rows.length;
}

async function supersedePractitionerAssociation(
  db: Writer,
  args: {
    now: bigint;
    row: Doc<"practitionerAssociations">;
    userId?: Id<"users">;
  },
): Promise<void> {
  if (args.row.status !== "active") {
    return;
  }

  await db.patch("practitionerAssociations", args.row._id, {
    lastModified: args.now,
    status: "superseded",
    supersededAt: args.now,
    ...(args.userId === undefined ? {} : { supersededByUserId: args.userId }),
  });
}

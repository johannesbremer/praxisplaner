import { ConvexError } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

import {
  buildPatientSearchFirstName,
  buildPatientSearchLastName,
} from "./patientSearch";

export const INVALID_TEMPORARY_PATIENT_MESSAGE =
  "Temporäre Patienten benötigen einen Namen und eine Telefonnummer.";

export async function createTemporaryPatientRecord(
  ctx: MutationCtx,
  args: {
    name: string;
    phoneNumber: string;
    practiceId: Id<"practices">;
  },
): Promise<Id<"patients">> {
  const temporaryPatient = await createTemporaryPatientRecordWithIdentity(
    ctx,
    args,
  );
  return temporaryPatient.patientId;
}

export async function createTemporaryPatientRecordWithIdentity(
  ctx: MutationCtx,
  args: {
    name: string;
    phoneNumber: string;
    practiceId: Id<"practices">;
  },
): Promise<{
  bookingIdentityId: Id<"bookingIdentities">;
  patientId: Id<"patients">;
}> {
  const { name, phoneNumber } = normalizeTemporaryPatientInput(args);
  const now = BigInt(Date.now());
  const bookingIdentityId = await ctx.db.insert("bookingIdentities", {
    createdAt: now,
    kind: "temporary",
    lastModified: now,
    practiceId: args.practiceId,
  });

  const patientId = await ctx.db.insert("patients", {
    bookingIdentityId,
    createdAt: now,
    insuranceStatus: "unknown",
    lastModified: now,
    name,
    phoneNumber,
    practiceId: args.practiceId,
    recordType: "temporary",
    searchFirstName: buildPatientSearchFirstName({
      name,
    }),
    searchLastName: buildPatientSearchLastName({
      name,
    }),
  });

  return { bookingIdentityId, patientId };
}

export function normalizeTemporaryPatientInput(args: {
  name: string;
  phoneNumber: string;
}) {
  const name = args.name.trim();
  const phoneNumber = args.phoneNumber.trim();

  if (name.length === 0 || phoneNumber.length === 0) {
    throw invalidTemporaryPatientError();
  }

  return { name, phoneNumber };
}

function invalidTemporaryPatientError() {
  return new ConvexError({
    code: "INVALID_TEMPORARY_PATIENT",
    message: INVALID_TEMPORARY_PATIENT_MESSAGE,
  });
}

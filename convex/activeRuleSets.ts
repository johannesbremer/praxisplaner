import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

export async function getActiveRuleSet(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<Doc<"ruleSets"> | null> {
  const activeRuleSetId = await getActiveRuleSetId(db, practiceId);
  return activeRuleSetId ? await db.get("ruleSets", activeRuleSetId) : null;
}

export async function getActiveRuleSetId(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<Id<"ruleSets"> | null> {
  const activation = await db
    .query("ruleSetActivations")
    .withIndex("by_practiceId_activatedAt", (q) =>
      q.eq("practiceId", practiceId),
    )
    .order("desc")
    .first();

  return activation?.ruleSetId ?? null;
}

export async function recordRuleSetActivation(
  db: DatabaseWriter,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<void> {
  await db.insert("ruleSetActivations", {
    activatedAt: BigInt(Date.now()),
    practiceId: args.practiceId,
    ruleSetId: args.ruleSetId,
  });
}

export async function requireActiveRuleSetId(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<Id<"ruleSets">> {
  const activeRuleSetId = await getActiveRuleSetId(db, practiceId);
  if (!activeRuleSetId) {
    throw new Error("Practice violates the Active Rule Set invariant.");
  }
  return activeRuleSetId;
}

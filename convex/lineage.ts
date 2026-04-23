import type { GenericDatabaseWriter } from "convex/server";

import type { DataModel, Doc, Id } from "./_generated/dataModel";

type DatabaseWriter = GenericDatabaseWriter<DataModel>;

type InsertValue<TableName extends SelfLineageTableName> = Omit<
  Doc<TableName>,
  "_creationTime" | "_id" | "lineageKey"
> & {
  lineageKey?: Id<TableName>;
};

type SelfLineageInsertParams =
  | ["appointmentTypes", InsertValue<"appointmentTypes">]
  | ["baseSchedules", InsertValue<"baseSchedules">]
  | ["locations", InsertValue<"locations">]
  | ["mfas", InsertValue<"mfas">]
  | ["practitioners", InsertValue<"practitioners">]
  | ["vacations", InsertValue<"vacations">];

type SelfLineageTableName =
  | "appointmentTypes"
  | "baseSchedules"
  | "locations"
  | "mfas"
  | "practitioners"
  | "vacations";

export async function insertSelfLineageEntity(
  db: DatabaseWriter,
  table: "appointmentTypes",
  value: InsertValue<"appointmentTypes">,
): Promise<Id<"appointmentTypes">>;
export async function insertSelfLineageEntity(
  db: DatabaseWriter,
  table: "baseSchedules",
  value: InsertValue<"baseSchedules">,
): Promise<Id<"baseSchedules">>;
export async function insertSelfLineageEntity(
  db: DatabaseWriter,
  table: "locations",
  value: InsertValue<"locations">,
): Promise<Id<"locations">>;
export async function insertSelfLineageEntity(
  db: DatabaseWriter,
  table: "mfas",
  value: InsertValue<"mfas">,
): Promise<Id<"mfas">>;
export async function insertSelfLineageEntity(
  db: DatabaseWriter,
  table: "practitioners",
  value: InsertValue<"practitioners">,
): Promise<Id<"practitioners">>;
export async function insertSelfLineageEntity(
  db: DatabaseWriter,
  table: "vacations",
  value: InsertValue<"vacations">,
): Promise<Id<"vacations">>;
export async function insertSelfLineageEntity(
  db: DatabaseWriter,
  ...params: SelfLineageInsertParams
) {
  switch (params[0]) {
    case "appointmentTypes": {
      const [tableName, tableValue] = params;
      const entityId = await db.insert(tableName, tableValue);
      if (!tableValue.lineageKey) {
        await db.patch(tableName, entityId, {
          lineageKey: entityId,
        });
      }
      return entityId;
    }
    case "baseSchedules": {
      const [tableName, tableValue] = params;
      const entityId = await db.insert(tableName, tableValue);
      if (!tableValue.lineageKey) {
        await db.patch(tableName, entityId, {
          lineageKey: entityId,
        });
      }
      return entityId;
    }
    case "locations": {
      const [tableName, tableValue] = params;
      const entityId = await db.insert(tableName, tableValue);
      if (!tableValue.lineageKey) {
        await db.patch(tableName, entityId, {
          lineageKey: entityId,
        });
      }
      return entityId;
    }
    case "mfas": {
      const [tableName, tableValue] = params;
      const entityId = await db.insert(tableName, tableValue);
      if (!tableValue.lineageKey) {
        await db.patch(tableName, entityId, {
          lineageKey: entityId,
        });
      }
      return entityId;
    }
    case "practitioners": {
      const [tableName, tableValue] = params;
      const entityId = await db.insert(tableName, tableValue);
      if (!tableValue.lineageKey) {
        await db.patch(tableName, entityId, {
          lineageKey: entityId,
        });
      }
      return entityId;
    }
    case "vacations": {
      const [tableName, tableValue] = params;
      const entityId = await db.insert(tableName, tableValue);
      if (!tableValue.lineageKey) {
        await db.patch(tableName, entityId, {
          lineageKey: entityId,
        });
      }
      return entityId;
    }
  }
}
export function requireLineageKey<T extends string>(params: {
  entityId: string;
  entityType:
    | "appointment type"
    | "base schedule"
    | "location"
    | "mfa"
    | "practitioner"
    | "vacation";
  lineageKey: T | undefined;
  ruleSetId: Id<"ruleSets">;
}): T {
  if (!params.lineageKey) {
    throw new Error(
      `[INVARIANT:LINEAGE_KEY_MISSING] ${params.entityType} ${params.entityId} in Regelset ${params.ruleSetId} hat keinen lineageKey.`,
    );
  }
  return params.lineageKey;
}

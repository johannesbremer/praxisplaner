import type { Id, TableNames } from "./_generated/dataModel";

export type AppointmentTypeId = EntityId<"appointmentTypes">;

export type AppointmentTypeLineageKey = LineageKey<"appointmentTypes">;

export type BaseScheduleId = EntityId<"baseSchedules">;

export type BaseScheduleLineageKey = LineageKey<"baseSchedules">;
export type EntityId<TableName extends TableNames> = Brand<
  Id<TableName>,
  `${TableName}:entity`
>;
export type LineageKey<TableName extends LineageTableName> = Brand<
  Id<TableName>,
  `${TableName}:lineage`
>;

export type LocationId = EntityId<"locations">;
export type LocationLineageKey = LineageKey<"locations">;
export type MfaId = EntityId<"mfas">;
export type MfaLineageKey = LineageKey<"mfas">;
export type PractitionerId = EntityId<"practitioners">;
export type PractitionerLineageKey = LineageKey<"practitioners">;
export type VacationLineageKey = LineageKey<"vacations">;
type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };
type LineageTableName = Extract<
  TableNames,
  | "appointmentTypes"
  | "baseSchedules"
  | "locations"
  | "mfas"
  | "practitioners"
  | "vacations"
>;

export function asAppointmentTypeId(
  id: Id<"appointmentTypes">,
): AppointmentTypeId {
  return asEntityId(id);
}

export function asAppointmentTypeLineageKey(
  id: Id<"appointmentTypes">,
): AppointmentTypeLineageKey {
  return asLineageKey(id);
}

export function asBaseScheduleId(id: Id<"baseSchedules">): BaseScheduleId {
  return asEntityId(id);
}

export function asBaseScheduleLineageKey(
  id: Id<"baseSchedules">,
): BaseScheduleLineageKey {
  return asLineageKey(id);
}

export function asEntityId<TableName extends TableNames>(
  id: Id<TableName>,
): EntityId<TableName> {
  return id as EntityId<TableName>;
}

export function asLineageKey<TableName extends LineageTableName>(
  id: Id<TableName>,
): LineageKey<TableName> {
  return id as LineageKey<TableName>;
}

export function asLocationId(id: Id<"locations">): LocationId {
  return asEntityId(id);
}

export function asLocationLineageKey(id: Id<"locations">): LocationLineageKey {
  return asLineageKey(id);
}

export function asMfaId(id: Id<"mfas">): MfaId {
  return asEntityId(id);
}

export function asMfaLineageKey(id: Id<"mfas">): MfaLineageKey {
  return asLineageKey(id);
}

export function asPractitionerId(id: Id<"practitioners">): PractitionerId {
  return asEntityId(id);
}

export function asPractitionerLineageKey(
  id: Id<"practitioners">,
): PractitionerLineageKey {
  return asLineageKey(id);
}

export function asVacationLineageKey(id: Id<"vacations">): VacationLineageKey {
  return asLineageKey(id);
}

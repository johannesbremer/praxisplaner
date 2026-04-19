import type { Id, TableNames } from "../../convex/_generated/dataModel";

export function createOptimisticId<
  TableName extends TableNames,
>(): Id<TableName> {
  return globalThis.crypto.randomUUID() as Id<TableName>;
}

export function findEntityById<
  TableName extends TableNames,
  TEntity extends { _id: Id<TableName> },
>(entities: readonly TEntity[], value: string): TEntity | undefined {
  return entities.find((entity) => entity._id === value);
}

export function findIdInList<TableName extends TableNames>(
  ids: readonly Id<TableName>[],
  value: string,
): Id<TableName> | undefined {
  return ids.find((id) => id === value);
}

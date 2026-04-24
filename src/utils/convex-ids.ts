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

export function isOptimisticId(value: string): boolean {
  const parts = value.split("-");
  if (parts.length !== 5) {
    return false;
  }

  const [part1, part2, part3, part4, part5] = parts;
  if (
    part1?.length !== 8 ||
    part2?.length !== 4 ||
    part3?.length !== 4 ||
    part4?.length !== 4 ||
    part5?.length !== 12
  ) {
    return false;
  }

  if (
    !isHexSegment(part1) ||
    !isHexSegment(part2) ||
    !isHexSegment(part3) ||
    !isHexSegment(part4) ||
    !isHexSegment(part5)
  ) {
    return false;
  }

  if (!"12345".includes(part3[0] ?? "")) {
    return false;
  }

  return "89abAB".includes(part4[0] ?? "");
}

function isHexSegment(segment: string): boolean {
  for (const char of segment) {
    if (!"0123456789abcdefABCDEF".includes(char)) {
      return false;
    }
  }

  return true;
}

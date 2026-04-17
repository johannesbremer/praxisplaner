export function isRuleSetEntityDeleted(
  entity: null | undefined | { deleted?: boolean },
): boolean {
  return entity?.deleted === true;
}

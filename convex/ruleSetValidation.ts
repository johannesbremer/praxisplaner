// convex/ruleSetValidation.ts
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Validates that the provided ruleSetId belongs to the specified practice.
 * This prevents malicious or buggy clients from passing incorrect ruleSetIds
 * that could result in data being created in the wrong rule set.
 * @throws Error if the rule set is not found or doesn't belong to the practice
 */
export async function validateRuleSetBelongsToPractice(
  ctx: QueryCtx,
  ruleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<void> {
  const ruleSet = await ctx.db.get(ruleSetId);

  if (!ruleSet) {
    throw new Error("Rule set not found");
  }

  if (ruleSet.practiceId !== practiceId) {
    throw new Error(
      "Rule set does not belong to this practice. Potential security violation.",
    );
  }
}

/**
 * Validates that the entity belongs to the specified rule set.
 * This is used for update/delete operations to ensure copy-on-write is handled correctly.
 * @returns The entity if found and validation passes
 * @throws Error if the entity is not found
 */
export async function validateEntityBelongsToRuleSet<
  T extends { practiceId: Id<"practices"> },
>(
  ctx: QueryCtx,
  entity: null | T,
  entityType: string,
  targetRuleSetId: Id<"ruleSets">,
): Promise<T> {
  if (!entity) {
    throw new Error(`${entityType} not found`);
  }

  // Verify the target rule set exists and belongs to the same practice
  await validateRuleSetBelongsToPractice(
    ctx,
    targetRuleSetId,
    entity.practiceId,
  );

  return entity;
}

/**
 * Checks if an entity can be directly modified (same rule set) or needs copy-on-write.
 * This is the core logic for determining whether to patch/delete or create new entities.
 * @returns true if the entity belongs to the target rule set (can modify directly)
 */
export function canModifyDirectly(
  entityRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
): boolean {
  return entityRuleSetId === targetRuleSetId;
}

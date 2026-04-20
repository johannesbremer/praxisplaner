import type { Validator } from "convex/values";

import { v } from "convex/values";

/**
 * Convex validators serialize to a finite JSON tree and currently have no
 * lazy/reference node. That makes truly unbounded recursive validators
 * impossible at the validator layer.
 *
 * This helper builds the next-best representation: a depth-bounded recursive
 * union validator. The unavoidable type cast stays isolated here instead of
 * leaking into each recursive domain model.
 */
export function createDepthBoundedRecursiveUnionValidator<
  TLeaf,
  TBranch,
>(params: {
  branch: (
    child: Validator<TBranch | TLeaf, "required", string>,
  ) => Validator<TBranch, "required", string>;
  depth: number;
  leaf: Validator<TLeaf, "required", string>;
}): Validator<TBranch | TLeaf, "required", string> {
  if (params.depth <= 0) {
    return params.leaf as Validator<TBranch | TLeaf, "required", string>;
  }

  const childValidator = createDepthBoundedRecursiveUnionValidator({
    ...params,
    depth: params.depth - 1,
  });

  return v.union(params.branch(childValidator), params.leaf) as Validator<
    TBranch | TLeaf,
    "required",
    string
  >;
}

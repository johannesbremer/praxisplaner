import type { DatabaseReader } from "./_generated/server";

import { toPracticeSlug } from "../lib/practice-slug";
import { RESERVED_TOP_LEVEL_ROUTE_SEGMENTS } from "../lib/reserved-top-level-route-segments";

const RESERVED_TOP_LEVEL_ROUTE_SEGMENT_SET: ReadonlySet<string> = new Set(
  RESERVED_TOP_LEVEL_ROUTE_SEGMENTS,
);

export async function allocateUniquePracticeSlug(
  db: DatabaseReader,
  name: string,
): Promise<string> {
  const baseSlug = toPracticeSlug(name);
  let candidate = baseSlug;
  let suffix = 2;

  while (
    RESERVED_TOP_LEVEL_ROUTE_SEGMENT_SET.has(candidate) ||
    (await practiceSlugExists(db, candidate))
  ) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function practiceSlugExists(
  db: DatabaseReader,
  slug: string,
): Promise<boolean> {
  const existing = await db
    .query("practices")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  return existing !== null;
}

import type { DatabaseReader } from "./_generated/server";

import { toPracticeSlug } from "../lib/practice-slug";

export async function allocateUniquePracticeSlug(
  db: DatabaseReader,
  name: string,
): Promise<string> {
  const baseSlug = toPracticeSlug(name);
  let candidate = baseSlug;
  let suffix = 2;

  while (await practiceSlugExists(db, candidate)) {
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

import { regex } from "./arkregex";

const COMBINING_MARKS_REGEX = regex.as(String.raw`[\u0300-\u036f]`, "g");
const NON_SLUG_CHARACTER_REGEX = regex.as("[^a-z0-9]+", "g");
const EDGE_DASHES_REGEX = regex.as("^-+|-+$", "g");

export function toPracticeSlug(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(COMBINING_MARKS_REGEX, "")
    .replaceAll(NON_SLUG_CHARACTER_REGEX, "-")
    .replaceAll(EDGE_DASHES_REGEX, "");

  return normalized.length > 0 ? normalized : "praxis";
}

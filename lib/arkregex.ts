import type { RegexParser } from "arkregex/internal/regex.js";

const regexBase = ((src: string, flags?: string) =>
  new RegExp(src, flags)) as RegexParser;

regexBase.as = ((src: string, flags?: string) =>
  new RegExp(src, flags)) as RegexParser["as"];

export const regex = regexBase;
export type { Regex } from "arkregex/internal/regex.js";

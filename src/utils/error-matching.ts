import { SOURCE_RULE_SET_NOT_FOUND_REGEX } from "@/lib/typed-regex";

export function isMissingRuleSetEntityError(
  error: unknown,
  missingEntityRegex: RegExp,
): error is Error {
  return (
    error instanceof Error &&
    !SOURCE_RULE_SET_NOT_FOUND_REGEX.test(error.message) &&
    missingEntityRegex.test(error.message)
  );
}

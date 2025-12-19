import { expect } from "vitest";

/**
 * Type-safe assertion helper for non-null/undefined values.
 * Uses TypeScript's `asserts` return type to narrow the type after the call.
 * @example
 * const value = maybeUndefined;
 * assertDefined(value); // Throws if null/undefined
 * doSomething(value); // TypeScript knows value is defined
 */
export function assertDefined<T>(
  value: null | T | undefined,
  message = "Expected value to be defined",
): asserts value is T {
  expect(value, message).toBeDefined();
}

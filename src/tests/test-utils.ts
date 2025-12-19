import { expect } from "vitest";

/**
 * Type-safe assertion helper for DOM elements.
 * Uses TypeScript's `asserts` return type to narrow the type after the call.
 * @example
 * const element = container.querySelector(".my-class");
 * assertElement(element); // Throws if null/undefined, narrows type to Element
 * fireEvent.click(element); // TypeScript knows element is not null
 */
export function assertElement<T extends Element>(
  element: null | T | undefined,
  message = "Expected element to be in the document",
): asserts element is T {
  expect(element, message).toBeInTheDocument();
}

/**
 * Type-safe querySelector that throws if element is not found.
 * Returns a properly typed, non-null element.
 * @example
 * const element = queryElement(container, ".my-class");
 * fireEvent.click(element); // TypeScript knows element is not null
 */
export function queryElement(
  container: Document | Element,
  selector: string,
  message?: string,
): Element {
  const element = container.querySelector(selector);
  assertElement(element, message ?? `Expected to find element: ${selector}`);
  return element;
}

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

/**
 * Discriminated union helper types for validation results.
 * These allow proper type narrowing without type assertions.
 */
interface ValidationError<TError> {
  error: TError;
  isValid: false;
}

type ValidationResult<TError> = ValidationError<TError> | ValidationSuccess;

interface ValidationSuccess {
  isValid: true;
}

/**
 * Type-safe assertion for invalid validation results.
 * Narrows the type to access the `error` property safely.
 * @example
 * const result = validateSomething();
 * assertInvalidResult(result);
 * expect(result.error.type).toBe("SOME_ERROR"); // TypeScript knows error exists
 */
export function assertInvalidResult<TError>(
  result: ValidationResult<TError>,
  message = "Expected validation to fail",
): asserts result is ValidationError<TError> {
  expect(result.isValid, message).toBe(false);
}

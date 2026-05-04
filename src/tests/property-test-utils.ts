import type { Parameters } from "fast-check";

const DEFAULT_FAST_CHECK_TIME_LIMIT_MS = 8 * 60 * 60 * 1000;

export function propertyTestParameters<T = void>(
  overrides: Parameters<T> = {},
): Parameters<T> {
  const parameters: Parameters<T> = {
    interruptAfterTimeLimit:
      parsePositiveIntegerEnv("FAST_CHECK_TIME_LIMIT_MS") ??
      DEFAULT_FAST_CHECK_TIME_LIMIT_MS,
    numRuns:
      parsePositiveIntegerEnv("FAST_CHECK_NUM_RUNS") ??
      Number.POSITIVE_INFINITY,
    ...overrides,
  };
  const seed = parsePositiveIntegerEnv("FAST_CHECK_SEED");
  if (seed !== undefined) {
    parameters.seed = seed;
  }
  const timeout = parsePositiveIntegerEnv("FAST_CHECK_TIMEOUT_MS");
  if (timeout !== undefined) {
    parameters.timeout = timeout;
  }
  return parameters;
}

function parsePositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }

  return parsed;
}

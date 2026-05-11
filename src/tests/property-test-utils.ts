import fc, {
  type IAsyncPropertyWithHooks,
  type IPropertyWithHooks,
  type Parameters,
  type RunDetails,
} from "fast-check";

/**
 * Property-test lanes:
 *
 * - `pnpm test:property` is the bounded lane. The script injects
 *   `FAST_CHECK_NUM_RUNS=100` unless you override it explicitly.
 * - `pnpm ci-check` runs the bounded lane with `FAST_CHECK_SEED=1` unless CI
 *   overrides it explicitly, so failures are reproducible by default.
 * - `pnpm test:property:overnight` is the fuzzing lane. It relies on the
 *   defaults below: unbounded `numRuns` plus `interruptAfterTimeLimit`.
 *
 * Environment overrides:
 *
 * - `FAST_CHECK_NUM_RUNS`: explicit bounded run count.
 * - `FAST_CHECK_TIME_LIMIT_MS`: total fuzzing budget for the overnight lane.
 * - `FAST_CHECK_SEED`: fixed seed for reproducible failures.
 * - `FAST_CHECK_TIMEOUT_MS`: per-run timeout passed through to fast-check.
 *
 * Reproduce a failure by rerunning the same lane with the reported seed, for
 * example:
 *
 * `FAST_CHECK_SEED=12345 pnpm --silent test:property`
 * `FAST_CHECK_SEED=12345 FAST_CHECK_TIME_LIMIT_MS=28800000 pnpm --silent test:property:overnight`
 */
const DEFAULT_FAST_CHECK_TIME_LIMIT_MS = 8 * 60 * 60 * 1000;
const DEFAULT_FAST_CHECK_PROGRESS_EVERY = 10_000;

interface PropertyProgress {
  label: string;
  ratePerSecond: number;
  runs: number;
}

export const PROPERTY_PROGRESS_EVENT_PREFIX = "[fast-check-progress]";

let propertyRunCounter = 0;

export async function assertAsyncProperty<T extends [unknown, ...unknown[]]>(
  property: IAsyncPropertyWithHooks<T>,
  label: string,
  overrides: Parameters<T> = {},
): Promise<void> {
  const { onRun, parameters } = propertyTestParameters(label, overrides);
  await fc.assert(
    property.beforeEach(async (previousHook) => {
      await previousHook();
      onRun();
    }),
    parameters,
  );
}

export function assertProperty<T extends [unknown, ...unknown[]]>(
  property: IPropertyWithHooks<T>,
  label: string,
  overrides: Parameters<T> = {},
): void {
  const { onRun, parameters } = propertyTestParameters(label, overrides);
  fc.assert(
    property.beforeEach((previousHook) => {
      previousHook();
      onRun();
    }),
    parameters,
  );
}

export async function checkAsyncProperty<T extends [unknown, ...unknown[]]>(
  property: IAsyncPropertyWithHooks<T>,
  label: string,
  overrides: Parameters<T> = {},
): Promise<RunDetails<T>> {
  const { onRun, parameters } = propertyTestParameters(label, overrides);
  const result = await fc.check(
    property.beforeEach(async (previousHook) => {
      await previousHook();
      onRun();
    }),
    parameters,
  );
  assertRunCompleted(result, label);
  return result;
}

export function checkProperty<T extends [unknown, ...unknown[]]>(
  property: IPropertyWithHooks<T>,
  label: string,
  overrides: Parameters<T> = {},
): RunDetails<T> {
  const { onRun, parameters } = propertyTestParameters(label, overrides);
  const result = fc.check(
    property.beforeEach((previousHook) => {
      previousHook();
      onRun();
    }),
    parameters,
  );
  assertRunCompleted(result, label);
  return result;
}

export function propertyTestParameters<T = void>(
  label: string,
  overrides: Parameters<T> = {},
): { onRun: () => void; parameters: Parameters<T> } {
  const progressEvery =
    parsePositiveIntegerEnv("FAST_CHECK_PROGRESS_EVERY") ??
    DEFAULT_FAST_CHECK_PROGRESS_EVERY;
  const progressLabel = label.trim() || `property-${propertyRunCounter + 1}`;
  propertyRunCounter += 1;
  let runs = 0;
  const startedAt = Date.now();

  const parameters: Parameters<T> = {
    interruptAfterTimeLimit:
      parsePositiveIntegerEnv("FAST_CHECK_TIME_LIMIT_MS") ??
      DEFAULT_FAST_CHECK_TIME_LIMIT_MS,
    numRuns:
      parsePositiveIntegerEnv("FAST_CHECK_NUM_RUNS") ??
      Number.POSITIVE_INFINITY,
    ...overrides,
  };
  const onRun = () => {
    runs += 1;
    if (runs % progressEvery === 0) {
      const elapsedMs = Date.now() - startedAt;
      const ratePerSecond =
        elapsedMs === 0 ? 0 : Math.round((runs * 1000) / elapsedMs);
      renderProgress({
        label: progressLabel,
        ratePerSecond,
        runs,
      });
    }
  };
  const seed = parsePositiveIntegerEnv("FAST_CHECK_SEED");
  if (seed !== undefined) {
    parameters.seed = seed;
  }
  const timeout = parsePositiveIntegerEnv("FAST_CHECK_TIMEOUT_MS");
  if (timeout !== undefined) {
    parameters.timeout = timeout;
  }
  return { onRun, parameters };
}

function assertRunCompleted<T extends [unknown, ...unknown[]]>(
  result: RunDetails<T>,
  label: string,
) {
  if (result.interrupted) {
    throw new Error(
      `Property "${label}" was interrupted before completing its configured run count.`,
    );
  }
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

function renderProgress(progress: PropertyProgress) {
  console.error(`${PROPERTY_PROGRESS_EVENT_PREFIX}${JSON.stringify(progress)}`);
}

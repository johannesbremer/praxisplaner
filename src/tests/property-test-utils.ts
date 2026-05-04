import fc, {
  type IAsyncPropertyWithHooks,
  type IPropertyWithHooks,
  type Parameters,
  type RunDetails,
} from "fast-check";

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
  return await fc.check(
    property.beforeEach(async (previousHook) => {
      await previousHook();
      onRun();
    }),
    parameters,
  );
}

export function checkProperty<T extends [unknown, ...unknown[]]>(
  property: IPropertyWithHooks<T>,
  label: string,
  overrides: Parameters<T> = {},
): RunDetails<T> {
  const { onRun, parameters } = propertyTestParameters(label, overrides);
  return fc.check(
    property.beforeEach((previousHook) => {
      previousHook();
      onRun();
    }),
    parameters,
  );
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

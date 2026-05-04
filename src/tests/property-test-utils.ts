import fc, {
  type IAsyncPropertyWithHooks,
  type IPropertyWithHooks,
  type Parameters,
  type RunDetails,
} from "fast-check";
import readline from "node:readline";

const DEFAULT_FAST_CHECK_TIME_LIMIT_MS = 8 * 60 * 60 * 1000;
const DEFAULT_FAST_CHECK_PROGRESS_EVERY = 10_000;

interface PropertyProgress {
  label: string;
  ratePerSecond: number;
  runs: number;
}

const progressByLabel = new Map<string, PropertyProgress>();

let propertyRunCounter = 0;

export async function assertAsyncProperty<T extends [unknown, ...unknown[]]>(
  property: IAsyncPropertyWithHooks<T>,
  overrides: Parameters<T> = {},
): Promise<void> {
  const { onRun, parameters } = propertyTestParameters(overrides);
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
  overrides: Parameters<T> = {},
): void {
  const { onRun, parameters } = propertyTestParameters(overrides);
  fc.assert(
    property.beforeEach((previousHook) => {
      previousHook();
      onRun();
    }),
    parameters,
  );
}

export function checkProperty<T extends [unknown, ...unknown[]]>(
  property: IPropertyWithHooks<T>,
  overrides: Parameters<T> = {},
): RunDetails<T> {
  const { onRun, parameters } = propertyTestParameters(overrides);
  return fc.check(
    property.beforeEach((previousHook) => {
      previousHook();
      onRun();
    }),
    parameters,
  );
}

export function propertyTestParameters<T = void>(
  overrides: Parameters<T> = {},
): { onRun: () => void; parameters: Parameters<T> } {
  const progressEvery =
    parsePositiveIntegerEnv("FAST_CHECK_PROGRESS_EVERY") ??
    DEFAULT_FAST_CHECK_PROGRESS_EVERY;
  const label = `property-${propertyRunCounter + 1}`;
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
        label,
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
  progressByLabel.set(progress.label, progress);
  const totalRuns = [...progressByLabel.values()].reduce(
    (sum, current) => sum + current.runs,
    0,
  );
  const totalRate = [...progressByLabel.values()].reduce(
    (sum, current) => sum + current.ratePerSecond,
    0,
  );
  const line = `[fast-check] runs=${totalRuns.toLocaleString("en-US")} rate=${totalRate.toLocaleString("en-US")}/s active=${progress.label}:${progress.runs.toLocaleString("en-US")}`;

  if (process.env["FAST_CHECK_PROGRESS_MODE"] === "lines") {
    process.stderr.write(`${line}\n`);
    return;
  }

  if (process.stderr.isTTY) {
    readline.clearLine(process.stderr, 0);
    readline.cursorTo(process.stderr, 0);
    process.stderr.write(line);
    return;
  }

  process.stderr.write(`\r${line}`);
}

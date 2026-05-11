import { globSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

const PROPERTY_PROGRESS_EVENT_PREFIX = "[fast-check-progress]";
const PROPERTY_TEST_INCLUDE = ["**/*.property.test.ts"];
const PROPERTY_TEST_EXCLUDE = [
  "**/node_modules/**",
  "**/playwright/**",
  "**/*.spec.ts",
];

const cwd = process.cwd();
const propertyFiles = globSync(PROPERTY_TEST_INCLUDE, {
  cwd,
  exclude: PROPERTY_TEST_EXCLUDE,
}).sort();

if (propertyFiles.length === 0) {
  console.error("No property test files found.");
  process.exit(1);
}

const maxProcesses =
  parsePositiveIntegerEnv("FAST_CHECK_MAX_WORKERS") ?? propertyFiles.length;
const childCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pendingFiles = [...propertyFiles];
const runningChildren = new Map();
const progressByLabel = new Map();
let renderedProgressLines = 0;
let failed = false;
let completedFiles = 0;

process.on("SIGINT", () => {
  shutdownChildren("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  shutdownChildren("SIGTERM");
  process.exit(143);
});

for (
  let index = 0;
  index < Math.min(maxProcesses, propertyFiles.length);
  index += 1
) {
  spawnNext();
}

function spawnNext() {
  if (failed) {
    return;
  }

  const propertyFile = pendingFiles.shift();
  if (!propertyFile) {
    if (runningChildren.size === 0) {
      finishProgressBlock();
      process.stderr.write(
        `Overnight property runner passed: ${completedFiles}/${propertyFiles.length} files completed.\n`,
      );
      process.exit(0);
    }
    return;
  }

  const child = spawn(
    childCommand,
    [
      "exec",
      "vitest",
      "--run",
      "--config",
      "vitest.property.config.ts",
      propertyFile,
    ],
    {
      cwd,
      env: {
        ...process.env,
        FAST_CHECK_EXTERNAL_PROGRESS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const childState = {
    file: propertyFile,
    stderr: [],
    stdout: [],
  };
  runningChildren.set(child.pid, { child, state: childState });

  pipeChildLines(child.stdout, (line) => {
    if (!handleProgressLine(line)) {
      childState.stdout.push(line);
    }
  });
  pipeChildLines(child.stderr, (line) => {
    if (!handleProgressLine(line)) {
      childState.stderr.push(line);
    }
  });

  child.on("exit", (code, signal) => {
    runningChildren.delete(child.pid);

    if (failed) {
      return;
    }

    if (code !== 0) {
      failed = true;
      finishProgressBlock();
      process.stderr.write(
        `Property file failed: ${propertyFile}${signal ? ` (${signal})` : ""}\n`,
      );
      printBufferedOutput(propertyFile, childState.stdout, "stdout");
      printBufferedOutput(propertyFile, childState.stderr, "stderr");
      shutdownChildren("SIGTERM");
      process.exit(code ?? 1);
    }

    completedFiles += 1;
    spawnNext();
  });
}

function pipeChildLines(stream, onLine) {
  const rl = readline.createInterface({ crlfDelay: Infinity, input: stream });
  rl.on("line", onLine);
}

function handleProgressLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PROPERTY_PROGRESS_EVENT_PREFIX)) {
    return false;
  }

  const rawPayload = trimmed.slice(PROPERTY_PROGRESS_EVENT_PREFIX.length);
  const parsed = JSON.parse(rawPayload);
  if (
    typeof parsed.label !== "string" ||
    typeof parsed.ratePerSecond !== "number" ||
    typeof parsed.runs !== "number"
  ) {
    return false;
  }

  progressByLabel.set(parsed.label, parsed);
  renderProgress();
  return true;
}

function finishProgressBlock() {
  if (renderedProgressLines === 0) {
    return;
  }
  process.stderr.write("\n");
  renderedProgressLines = 0;
}

function moveToProgressStart() {
  if (renderedProgressLines === 0) {
    return;
  }
  readline.moveCursor(process.stderr, 0, -renderedProgressLines);
}

function renderProgress() {
  const totalRuns = [...progressByLabel.values()].reduce(
    (sum, current) => sum + current.runs,
    0,
  );
  const totalRate = [...progressByLabel.values()].reduce(
    (sum, current) => sum + current.ratePerSecond,
    0,
  );
  const lines = [
    `[fast-check] running=${runningChildren.size}/${propertyFiles.length} completed=${completedFiles}/${propertyFiles.length} total=${totalRuns.toLocaleString("en-US")} rate=${totalRate.toLocaleString("en-US")}/s`,
    ...[...progressByLabel.values()].map(
      (current) =>
        `  ${current.label}: runs=${current.runs.toLocaleString("en-US")} rate=${current.ratePerSecond.toLocaleString("en-US")}/s`,
    ),
  ];

  moveToProgressStart();
  for (const line of lines) {
    readline.clearLine(process.stderr, 0);
    process.stderr.write(`${line}\n`);
  }
  renderedProgressLines = lines.length;
}

function printBufferedOutput(propertyFile, lines, streamName) {
  if (lines.length === 0) {
    return;
  }

  process.stderr.write(
    `--- ${path.basename(propertyFile)} ${streamName} ---\n`,
  );
  process.stderr.write(`${lines.join("\n")}\n`);
}

function shutdownChildren(signal) {
  for (const { child } of runningChildren.values()) {
    child.kill(signal);
  }
}

function parsePositiveIntegerEnv(name) {
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

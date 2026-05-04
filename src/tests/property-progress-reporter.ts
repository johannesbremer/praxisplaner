import type {
  SerializedError,
  TestModule,
  TestRunEndReason,
} from "vitest/node";

import readline from "node:readline";
import { DefaultReporter } from "vitest/node";

import { PROPERTY_PROGRESS_EVENT_PREFIX } from "./property-test-utils";

interface PropertyConsoleLog {
  browser?: boolean;
  content: string;
  origin?: string;
  size: number;
  taskId?: string;
  time: number;
  type: "stderr" | "stdout";
}

interface PropertyProgress {
  label: string;
  ratePerSecond: number;
  runs: number;
}

export default class PropertyProgressReporter extends DefaultReporter {
  private readonly progressByLabel = new Map<string, PropertyProgress>();
  private renderedProgressLines = 0;

  override onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly SerializedError[],
    reason: TestRunEndReason,
  ) {
    this.finishProgressBlock();
    super.onTestRunEnd(testModules, unhandledErrors, reason);
  }

  override onUserConsoleLog(log: PropertyConsoleLog) {
    const progresses = parseProgressLogs(log.content);
    if (progresses.length === 0) {
      super.onUserConsoleLog(log);
      return;
    }

    for (const progress of progresses) {
      this.progressByLabel.set(progress.label, progress);
    }
    this.renderProgress();
  }

  private finishProgressBlock() {
    if (this.renderedProgressLines === 0) {
      return;
    }
    process.stderr.write("\n");
    this.renderedProgressLines = 0;
  }

  private moveToProgressStart() {
    if (this.renderedProgressLines === 0) {
      return;
    }
    readline.moveCursor(process.stderr, 0, -this.renderedProgressLines);
  }

  private renderProgress() {
    const totalRuns = [...this.progressByLabel.values()].reduce(
      (sum, current) => sum + current.runs,
      0,
    );
    const totalRate = [...this.progressByLabel.values()].reduce(
      (sum, current) => sum + current.ratePerSecond,
      0,
    );
    const lines = [
      `[fast-check] total=${totalRuns.toLocaleString("en-US")} rate=${totalRate.toLocaleString("en-US")}/s`,
      ...[...this.progressByLabel.values()].map(
        (current) =>
          `  ${current.label}: runs=${current.runs.toLocaleString("en-US")} rate=${current.ratePerSecond.toLocaleString("en-US")}/s`,
      ),
    ];

    if (process.env["FAST_CHECK_PROGRESS_MODE"] === "lines") {
      process.stderr.write(`${lines.join("\n")}\n`);
      return;
    }

    this.moveToProgressStart();
    for (const line of lines) {
      readline.clearLine(process.stderr, 0);
      process.stderr.write(`${line}\n`);
    }
    this.renderedProgressLines = lines.length;
  }
}

function parseProgressLogs(content: string): PropertyProgress[] {
  const progresses: PropertyProgress[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(PROPERTY_PROGRESS_EVENT_PREFIX)) {
      continue;
    }

    const rawPayload = trimmed.slice(PROPERTY_PROGRESS_EVENT_PREFIX.length);
    const parsed = JSON.parse(rawPayload) as Partial<PropertyProgress>;
    if (
      typeof parsed.label !== "string" ||
      typeof parsed.ratePerSecond !== "number" ||
      typeof parsed.runs !== "number"
    ) {
      continue;
    }

    progresses.push({
      label: parsed.label,
      ratePerSecond: parsed.ratePerSecond,
      runs: parsed.runs,
    });
  }

  return progresses;
}

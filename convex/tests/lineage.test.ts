import type { GenericDatabaseReader } from "convex/server";

import { convexTest } from "convex-test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import type { DataModel } from "../_generated/dataModel";

import { insertSelfLineageEntity } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";

type SelfLineageTableName =
  | "appointmentTypes"
  | "baseSchedules"
  | "locations"
  | "mfas"
  | "practitioners"
  | "vacations";

async function collectMissingLineageKeys(
  db: GenericDatabaseReader<DataModel>,
): Promise<Record<SelfLineageTableName, string[]>> {
  const [
    appointmentTypes,
    baseSchedules,
    locations,
    mfas,
    practitioners,
    vacations,
  ] = await Promise.all([
    db.query("appointmentTypes").collect(),
    db.query("baseSchedules").collect(),
    db.query("locations").collect(),
    db.query("mfas").collect(),
    db.query("practitioners").collect(),
    db.query("vacations").collect(),
  ]);

  return {
    appointmentTypes: appointmentTypes
      .filter((entity) => !entity.lineageKey)
      .map((entity) => entity._id),
    baseSchedules: baseSchedules
      .filter((entity) => !entity.lineageKey)
      .map((entity) => entity._id),
    locations: locations
      .filter((entity) => !entity.lineageKey)
      .map((entity) => entity._id),
    mfas: mfas
      .filter((entity) => !entity.lineageKey)
      .map((entity) => entity._id),
    practitioners: practitioners
      .filter((entity) => !entity.lineageKey)
      .map((entity) => entity._id),
    vacations: vacations
      .filter((entity) => !entity.lineageKey)
      .map((entity) => entity._id),
  };
}

function createTestContext() {
  return convexTest(schema, modules);
}

const SELF_LINEAGE_INSERT_PATTERN =
  /\b(?:ctx\.)?db\.insert\("(?<table>appointmentTypes|baseSchedules|locations|mfas|practitioners|vacations)"/g;

const ALLOWED_DIRECT_SELF_LINEAGE_INSERT_FILES = new Set([
  "convex/lineage.ts",
  "convex/tests/appointmentSeries.test.ts",
  "convex/tests/lineage.test.ts",
  "convex/tests/vacations.test.ts",
]);

async function collectTypeScriptFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "_generated") {
          return [];
        }
        return await collectTypeScriptFiles(absolutePath);
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
        return [];
      }
      return [absolutePath];
    }),
  );
  return nestedFiles.flat();
}

async function collectUnexpectedDirectSelfLineageInserts() {
  const repoRoot = process.cwd();
  const files = await collectTypeScriptFiles(path.join(repoRoot, "convex"));
  const violations: string[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(repoRoot, filePath);
    const content = await readFile(filePath, "utf8");

    for (const match of content.matchAll(SELF_LINEAGE_INSERT_PATTERN)) {
      if (ALLOWED_DIRECT_SELF_LINEAGE_INSERT_FILES.has(relativePath)) {
        continue;
      }
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = beforeMatch.split("\n").length;
      const tableName = match.groups?.["table"] ?? "unknown";
      violations.push(`${relativePath}:${lineNumber} inserts ${tableName}`);
    }
  }

  return violations;
}

describe("lineage invariants", () => {
  test("self-lineage tables do not contain rows without lineage keys", async () => {
    const t = createTestContext();

    const missing = await t.run(async (ctx) => {
      const practiceId = await ctx.db.insert("practices", {
        name: "Lineage Audit Practice",
      });
      const ruleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Lineage Audit Rule Set",
        draftRevision: 0,
        practiceId,
        saved: true,
        version: 1,
      });

      const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
        name: "Main Location",
        practiceId,
        ruleSetId,
      });
      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Audit",
          practiceId,
          ruleSetId,
        },
      );
      const mfaId = await insertSelfLineageEntity(ctx.db, "mfas", {
        createdAt: BigInt(Date.now()),
        name: "MFA Audit",
        practiceId,
        ruleSetId,
      });
      await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
        allowedPractitionerIds: [practitionerId],
        createdAt: BigInt(Date.now()),
        duration: 30,
        lastModified: BigInt(Date.now()),
        name: "Checkup",
        practiceId,
        ruleSetId,
      });
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: 1,
        endTime: "17:00",
        locationId,
        practiceId,
        practitionerId,
        ruleSetId,
        startTime: "08:00",
      });
      await insertSelfLineageEntity(ctx.db, "vacations", {
        createdAt: BigInt(Date.now()),
        date: "2026-02-02",
        mfaId,
        portion: "morning",
        practiceId,
        ruleSetId,
        staffType: "mfa",
      });

      return await collectMissingLineageKeys(ctx.db);
    });

    expect(missing).toEqual({
      appointmentTypes: [],
      baseSchedules: [],
      locations: [],
      mfas: [],
      practitioners: [],
      vacations: [],
    });
  });

  test("the lineage audit catches broken rows explicitly", async () => {
    const t = createTestContext();

    const { missing, missingLocationId } = await t.run(async (ctx) => {
      const practiceId = await ctx.db.insert("practices", {
        name: "Broken Lineage Practice",
      });
      const ruleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Broken Lineage Rule Set",
        draftRevision: 0,
        practiceId,
        saved: true,
        version: 1,
      });

      const missingLocationId = await ctx.db.insert("locations", {
        name: "Broken Location",
        practiceId,
        ruleSetId,
      });

      return {
        missing: await collectMissingLineageKeys(ctx.db),
        missingLocationId,
      };
    });

    expect(missing.locations).toHaveLength(1);
    expect(missing.locations[0]).toBe(missingLocationId);
  });

  test("self-lineage writes go through the shared insert helper", async () => {
    const violations = await collectUnexpectedDirectSelfLineageInserts();

    expect(violations).toEqual([]);
  });
});

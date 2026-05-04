import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { Doc, Id } from "@/convex/_generated/dataModel";

import { toTableId } from "../../convex/identity";
import { UNSAVED_RULE_SET_DESCRIPTION } from "../routes/regeln/-rule-set-diff";
import {
  selectRuleSetLifecycle,
  summarizeRuleSets,
} from "../routes/regeln/-rule-set-lifecycle";
import { assertAsyncProperty } from "./property-test-utils";

describe("rule set lifecycle draft parent property", () => {
  test("selectRuleSetLifecycle keeps drafts attached to their parent Rule Set", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.integer({ max: 100, min: 1 }),
        fc.integer({ max: 100, min: 1 }),
        async (activeVersion, draftRevision) => {
          await Promise.resolve();
          const active = ruleSetDoc({
            id: "active",
            saved: true,
            version: activeVersion,
          });
          const draft = ruleSetDoc({
            description: UNSAVED_RULE_SET_DESCRIPTION,
            draftRevision,
            id: "draft",
            parentVersion: active._id,
            saved: false,
            version: activeVersion + 1,
          });
          const ruleSets = [active, draft];
          const selection = selectRuleSetLifecycle({
            rawRuleSetSearch: undefined,
            ruleSetIdFromUrl: undefined,
            ruleSets,
            ruleSetSummaries: summarizeRuleSets(ruleSets, active._id),
            trackedDraftRuleSetId: null,
          });

          expect(selection.active?._id).toBe(active._id);
          expect(selection.draft?.parentVersion).toBe(active._id);
          expect(selection.working?._id).toBe(draft._id);
          expect(selection.navigation.trackedDraftRuleSetId).toBe(draft._id);
        },
      ),
      "rule set lifecycle preserves draft parent",
    );
  });
});

function ruleSetDoc(args: {
  description?: string;
  draftRevision?: number;
  id: string;
  parentVersion?: Id<"ruleSets">;
  saved: boolean;
  version: number;
}): Doc<"ruleSets"> {
  return {
    _creationTime: 1,
    _id: toTableId<"ruleSets">(`rules_${args.id}`),
    createdAt: 1,
    description: args.description ?? `Rule Set ${args.version}`,
    draftRevision: args.saved ? 0 : (args.draftRevision ?? 1),
    ...(args.parentVersion ? { parentVersion: args.parentVersion } : {}),
    practiceId: toTableId<"practices">("practice"),
    saved: args.saved,
    version: args.version,
  };
}

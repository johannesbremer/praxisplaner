export interface EncodedRuleSetSnapshot<TSnapshot> {
  snapshot: TSnapshot;
  stableKey: string;
}

export function encodeRuleSetSnapshot<TSnapshot>(
  snapshot: TSnapshot,
): EncodedRuleSetSnapshot<TSnapshot> {
  return {
    snapshot,
    stableKey: stableStringify(snapshot),
  };
}

export function snapshotsMatch(
  left: EncodedRuleSetSnapshot<unknown>,
  right: EncodedRuleSetSnapshot<unknown>,
): boolean {
  return left.stableKey === right.stableKey;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJson(value));
}

function toStableJson(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toStableJson(item));
  }

  const entries = Object.entries(value).toSorted(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  return Object.fromEntries(
    entries.map(([key, entryValue]) => [key, toStableJson(entryValue)]),
  );
}

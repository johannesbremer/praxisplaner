import type { GdtField } from "./types";

import { GDT_FIELD_IDS } from "./types";
import { parseGdtLine } from "./validation";

/** Parses the entire GDT file content into an array of GdtField objects. */
export function parseGdtContent(content: string): GdtField[] {
  const fields: GdtField[] = [];
  const lines = content.replaceAll("\r\n", "\n").split("\n");

  // Find Satzart for Satzende
  const firstLineText = lines[0]?.trim() ?? "";
  const firstField = firstLineText ? parseGdtLine(firstLineText) : null;
  const satzartContent = firstField?.content || "6310";

  fields.push(
    ...lines
      .filter((line) => line.trim())
      .map((line) => parseGdtLine(line))
      .filter((f): f is GdtField => f !== null),
  );

  // Add Satzende if needed
  const lastField = fields[fields.length - 1];
  if (lastField?.fieldId !== GDT_FIELD_IDS.SATZ_END) {
    fields.push({
      content: satzartContent,
      fieldId: GDT_FIELD_IDS.SATZ_END,
      length: 13,
    });
  }

  return fields;
}

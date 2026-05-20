// @ts-check

/**
 * @typedef {{ defaultName: string } | { byLocationName: Map<string, string> }} LegacyPractitionerNameMapping
 */

/**
 * @typedef {{
 *   docId: string | undefined;
 *   locationName: string | undefined;
 * }} ImportedPractitionerNameFromLegacyDocArgs
 */

/** @type {Map<string, LegacyPractitionerNameMapping>} */
const LEGACY_DOC_TO_IMPORTED_PRACTITIONER_NAME = new Map([
  ["6z7483p3in4p35y", { defaultName: "Dr. A.-K. Averbeck" }],
  [
    "7881w9kibr7s1ss",
    {
      byLocationName: new Map([
        ["Bad Iburg", "IburgTrottenberg"],
        ["Dissen a.T.W.", "Miriam Trottenberg"],
      ]),
    },
  ],
  [
    "apnqqx6822u4vcx",
    {
      byLocationName: new Map([
        ["Bad Iburg", "Dr. K. Bremer Iburg"],
        ["Dissen a.T.W.", "Dr. K. Bremer Dissen"],
      ]),
    },
  ],
  ["euo2yrf744fhwjy", { defaultName: "Bettina Werner" }],
  ["fi3acv7aq2s99ae", { defaultName: "Nicy Kallarackal" }],
  ["iq8s3cqsa3sfd2z", { defaultName: "Dr. J. Wedegärtner" }],
  [
    "rey9an6loy33oun",
    {
      byLocationName: new Map([
        ["Bad Iburg", "Dr. V. MzH Iburg"],
        ["Dissen a.T.W.", "Dr. V. MzH Dissen"],
      ]),
    },
  ],
  ["z6mi9ounoj5qa5h", { defaultName: "Frauke Führmeyer" }],
]);

/** @type {(args: ImportedPractitionerNameFromLegacyDocArgs) => string | undefined} */
export const importedPractitionerNameFromLegacyDoc = (args) => {
  if (args.docId === undefined || args.docId.trim().length === 0) {
    return;
  }

  const mapping = LEGACY_DOC_TO_IMPORTED_PRACTITIONER_NAME.get(args.docId);
  if (mapping === undefined) {
    throw new Error(`Unmapped legacy practitioner doc id: ${args.docId}`);
  }

  if ("defaultName" in mapping) {
    return mapping.defaultName;
  }

  if (args.locationName === undefined) {
    return;
  }

  const practitionerName = mapping.byLocationName.get(args.locationName);
  if (practitionerName === undefined) {
    throw new Error(
      `Unmapped legacy practitioner doc location: ${args.docId} @ ${args.locationName}`,
    );
  }

  return practitionerName;
};

import { normalizeImportedPractitionerName } from "./practitioner-name-normalization.mts";

type LegacyPractitionerNameMapping =
  | { defaultName: string }
  | { byLocationName: Map<string, string> };

type ImportedPractitionerNameFromLegacyDocArgs = {
  docId: string | undefined;
  locationName: string | undefined;
};

const legacyDocToImportedPractitionerName = new Map<
  string,
  LegacyPractitionerNameMapping
>([
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

export function importedPractitionerNameFromLegacyDoc(
  args: ImportedPractitionerNameFromLegacyDocArgs,
): string | undefined {
  if (args.docId === undefined || args.docId.trim().length === 0) {
    return undefined;
  }

  const mapping = legacyDocToImportedPractitionerName.get(args.docId);
  if (mapping === undefined) {
    throw new Error(`Unmapped legacy practitioner doc id: ${args.docId}`);
  }

  if ("defaultName" in mapping) {
    return normalizeImportedPractitionerName(mapping.defaultName);
  }

  if (args.locationName === undefined) {
    return undefined;
  }

  const practitionerName = mapping.byLocationName.get(args.locationName);
  if (practitionerName === undefined) {
    throw new Error(
      `Unmapped legacy practitioner doc location: ${args.docId} @ ${args.locationName}`,
    );
  }

  return normalizeImportedPractitionerName(practitionerName);
}

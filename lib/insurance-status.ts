export const INSURANCE_STATUS_VALUES = [
  "private",
  "public",
  "unknown",
] as const;

export type InsuranceStatus = (typeof INSURANCE_STATUS_VALUES)[number];

export const INSURANCE_STATUS_LABELS: Record<InsuranceStatus, string> = {
  private: "Privat",
  public: "Gesetzlich",
  unknown: "Unbekannt",
};

export function insuranceStatusFromBookingInsuranceType(
  insuranceType: "gkv" | "pkv",
): Extract<InsuranceStatus, "private" | "public"> {
  return insuranceType === "pkv" ? "private" : "public";
}

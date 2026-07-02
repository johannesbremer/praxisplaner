export const INSURANCE_STATUS_VALUES = [
  "private",
  "public",
  "unknown",
] as const;

export type InsuranceStatus = (typeof INSURANCE_STATUS_VALUES)[number];
export type KnownInsuranceStatus = Exclude<InsuranceStatus, "unknown">;

export const INSURANCE_STATUS_LABELS: Record<InsuranceStatus, string> = {
  private: "Privat",
  public: "Gesetzlich",
  unknown: "Unbekannt",
};

export function insuranceStatusFromBookingInsuranceType(
  insuranceType: "gkv" | "pkv",
): KnownInsuranceStatus {
  return insuranceType === "pkv" ? "private" : "public";
}

export function isKnownInsuranceStatus(
  status: InsuranceStatus | undefined,
): status is KnownInsuranceStatus {
  return status === "private" || status === "public";
}

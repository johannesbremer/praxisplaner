import { v } from "convex/values";

export const legacyUiStepValidator = v.union(
  v.literal("privacy"),
  v.literal("location"),
  v.literal("patient-status"),
  v.literal("existing-doctor-selection"),
  v.literal("new-insurance-type"),
  v.literal("new-gkv-hzv"),
  v.literal("new-pkv-consent"),
  v.literal("new-pkv-details"),
  v.literal("personal-data"),
  v.literal("data-sharing"),
  v.literal("medical-history"),
  v.literal("calendar-selection"),
  v.literal("confirmation"),
);

export const legacyUnmatchedFutureBookingHoldSourceSystemValidator =
  v.literal("legacy-online");

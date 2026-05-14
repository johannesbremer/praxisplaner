import { normalizeE164PhoneNumber } from "./e164PhoneNumber";

export function normalizePracticePhoneNumber(rawPhoneNumber: string): string {
  return normalizeE164PhoneNumber({
    emptyMessage: "Practice phone number is required.",
    example: "+495421000000",
    invalidMessagePrefix: "Practice phone number",
    rawPhoneNumber,
  });
}

import { z } from "zod";

const e164PhoneNumberSchema = z.e164();

export function normalizePracticePhoneNumber(rawPhoneNumber: string): string {
  const trimmedPhoneNumber = rawPhoneNumber.trim();
  if (trimmedPhoneNumber.length === 0) {
    throw new Error("Practice phone number is required.");
  }

  const parsedPhoneNumber = e164PhoneNumberSchema.safeParse(trimmedPhoneNumber);
  if (!parsedPhoneNumber.success) {
    throw new Error(
      "Practice phone number must be provided in E.164 format, for example +495421000000.",
    );
  }

  return parsedPhoneNumber.data;
}

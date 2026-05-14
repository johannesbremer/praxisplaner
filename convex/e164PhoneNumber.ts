import { z } from "zod";

const e164PhoneNumberSchema = z.e164();

export function normalizeE164PhoneNumber(args: {
  emptyMessage: string;
  example: string;
  invalidMessagePrefix: string;
  rawPhoneNumber: string;
}): string {
  const trimmedPhoneNumber = args.rawPhoneNumber.trim();
  if (trimmedPhoneNumber.length === 0) {
    throw new Error(args.emptyMessage);
  }

  const parsedPhoneNumber = e164PhoneNumberSchema.safeParse(trimmedPhoneNumber);
  if (!parsedPhoneNumber.success) {
    throw new Error(
      `${args.invalidMessagePrefix} must be provided in E.164 format, for example ${args.example}.`,
    );
  }

  return parsedPhoneNumber.data;
}

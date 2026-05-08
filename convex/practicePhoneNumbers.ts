export function normalizePracticePhoneNumber(rawPhoneNumber: string): string {
  const trimmedPhoneNumber = rawPhoneNumber.trim();
  if (trimmedPhoneNumber.length === 0) {
    throw new Error("Practice phone number is required.");
  }

  let digits = "";
  for (const character of trimmedPhoneNumber) {
    if (character >= "0" && character <= "9") {
      digits += character;
    }
  }
  if (digits.length < 7) {
    throw new Error(
      "Practice phone number must contain at least 7 digits after normalization.",
    );
  }

  if (trimmedPhoneNumber.startsWith("+")) {
    return `+${digits}`;
  }

  if (trimmedPhoneNumber.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }

  return `+${digits}`;
}

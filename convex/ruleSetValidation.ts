/**
 * Shared validation logic for rule set descriptions.
 * Used by both frontend (instant feedback) and backend (security).
 */

// ================================
// CONSTANTS
// ================================

/**
 * Reserved description used for unsaved rule sets in URLs.
 * This cannot be used as a saved rule set description.
 */
export const RESERVED_UNSAVED_DESCRIPTION = "ungespeichert";

/**
 * Maximum length for rule set descriptions.
 * Prevents UI/URL issues with extremely long descriptions.
 */
export const MAX_DESCRIPTION_LENGTH = 100;

// ================================
// VALIDATION RESULT TYPE
// ================================

export interface RuleSetDescriptionValidationResult {
  error?: string;
  isValid: boolean;
}

// ================================
// VALIDATION FUNCTION
// ================================

/**
 * Validate if a description can be used for a saved rule set.
 * This is a pure function that can be used in both frontend and backend.
 * @param description The description to validate
 * @param existingSavedDescriptions Array of existing saved rule set descriptions
 * @returns Validation result with isValid flag and optional error message
 */
export function validateRuleSetDescriptionSync(
  description: string,
  existingSavedDescriptions: string[],
): RuleSetDescriptionValidationResult {
  const trimmedDescription = description.trim();

  // Check for empty description
  if (!trimmedDescription) {
    return { error: "Name ist erforderlich", isValid: false };
  }

  // Check for reserved name (case-sensitive)
  if (trimmedDescription === RESERVED_UNSAVED_DESCRIPTION) {
    return {
      error: `"${RESERVED_UNSAVED_DESCRIPTION}" ist ein reservierter Name`,
      isValid: false,
    };
  }

  // Check for max length
  if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
    return {
      error: `Name darf maximal ${MAX_DESCRIPTION_LENGTH} Zeichen lang sein`,
      isValid: false,
    };
  }

  // Check for duplicate (case-sensitive)
  const isDuplicate = existingSavedDescriptions.includes(trimmedDescription);
  if (isDuplicate) {
    return {
      error: "Ein Regelset mit diesem Namen existiert bereits",
      isValid: false,
    };
  }

  return { isValid: true };
}

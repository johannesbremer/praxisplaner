import { describe, expect, test } from "vitest";

import {
  extractPatientData,
  parseGdtContent,
} from "../../convex/gdt/processing";
import { GDT_ERROR_TYPES, GDT_FIELD_IDS } from "../../convex/gdt/types";
import {
  isValidDate,
  parseGdtLine,
  validateGdtContent,
} from "../../convex/gdt/validation";

describe("GDT Parser", () => {
  // Valid GDT file content provided in the issue
  const validGdtContent = `01380006310
014810000278
0178315PRAX_AIS
0178316LZBD_SYS
014921802.10
01092063
014300012345
0193101Mustermann
0143102Franz
017310301101945
01031101
0253107Musterstrasse 12
027310634567 Musterhausen
0158402BDM_01
017620027082010
0156201101246
0276220Termin 06.06.2025 `;

  describe("parseGdtLine", () => {
    test("should parse valid GDT line correctly", () => {
      const result = parseGdtLine("01380006310");
      expect(result).toEqual({
        content: "6310",
        fieldId: "8000",
        length: 13,
      });
    });

    test("should parse line with text content", () => {
      const result = parseGdtLine("0193101Mustermann");
      expect(result).toEqual({
        content: "Mustermann",
        fieldId: "3101",
        length: 19,
      });
    });

    test("should parse line with spaces in content", () => {
      const result = parseGdtLine("0253107Musterstrasse 12");
      expect(result).toEqual({
        content: "Musterstrasse 12",
        fieldId: "3107",
        length: 25,
      });
    });

    test("should handle line with trailing spaces", () => {
      const result = parseGdtLine("0276220Termin 06.06.2025 ");
      expect(result).toEqual({
        content: "Termin 06.06.2025",
        fieldId: "6220",
        length: 27,
      });
    });

    test("should return null for line too short", () => {
      const result = parseGdtLine("01234567");
      expect(result).toBeNull();
    });

    test("should return null for line with non-numeric length", () => {
      const result = parseGdtLine("abc80006310");
      expect(result).toBeNull();
    });

    test("should return null for empty line", () => {
      const result = parseGdtLine("");
      expect(result).toBeNull();
    });

    test("should handle minimum valid line length", () => {
      const result = parseGdtLine("009800012");
      expect(result).toEqual({
        content: "12",
        fieldId: "8000",
        length: 9,
      });
    });
  });

  describe("isValidDate", () => {
    test("should validate correct date format", () => {
      const result = isValidDate("01101945");
      expect(result).toEqual({
        isValid: true,
        value: "1945-10-01",
      });
    });

    test("should validate leap year February 29th", () => {
      const result = isValidDate("29022000");
      expect(result).toEqual({
        isValid: true,
        value: "2000-02-29",
      });
    });

    test("should reject non-leap year February 29th", () => {
      const result = isValidDate("29021999");
      expect(result).toEqual({
        error: {
          message: "Invalid day for February",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should reject date with wrong length", () => {
      const result = isValidDate("0110194");
      expect(result).toEqual({
        error: {
          message: "Date must be exactly 8 digits",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should reject date with non-numeric characters", () => {
      const result = isValidDate("01a01945");
      expect(result).toEqual({
        error: {
          message: "Date must be exactly 8 digits",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should reject invalid month", () => {
      const result = isValidDate("01131945");
      expect(result).toEqual({
        error: {
          message: "Invalid day or month values",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should reject invalid day", () => {
      const result = isValidDate("32101945");
      expect(result).toEqual({
        error: {
          message: "Invalid day or month values",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should reject year before 1900", () => {
      const result = isValidDate("01101899");
      expect(result).toEqual({
        error: {
          message: "Year must be between 1900 and current year",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should reject future year", () => {
      const currentYear = new Date().getFullYear();
      const futureYear = currentYear + 1;
      const result = isValidDate(`0101${futureYear}`);
      expect(result).toEqual({
        error: {
          message: "Year must be between 1900 and current year",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should reject April 31st", () => {
      const result = isValidDate("31041945");
      expect(result).toEqual({
        error: {
          message: "Invalid day for month",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should reject February 30th", () => {
      const result = isValidDate("30021945");
      expect(result).toEqual({
        error: {
          message: "Invalid day for February",
          type: GDT_ERROR_TYPES.INVALID_FORMAT,
        },
        isValid: false,
      });
    });

    test("should accept February 28th in non-leap year", () => {
      const result = isValidDate("28021999");
      expect(result).toEqual({
        isValid: true,
        value: "1999-02-28",
      });
    });

    test("should accept valid dates for months with 30 days", () => {
      const result = isValidDate("30041945");
      expect(result).toEqual({
        isValid: true,
        value: "1945-04-30",
      });
    });
  });

  describe("validateGdtContent", () => {
    test("should validate correct GDT content", () => {
      const result = validateGdtContent(validGdtContent);
      expect(result).toEqual({ isValid: true });
    });

    test("should reject empty file", () => {
      const result = validateGdtContent("");
      expect(result).toEqual({
        error: {
          message: "Empty GDT file",
          type: GDT_ERROR_TYPES.EMPTY_FILE,
        },
        isValid: false,
      });
    });

    test("should reject file with only whitespace", () => {
      const result = validateGdtContent("   \n  \r\n  ");
      expect(result).toEqual({
        error: {
          message: "Empty GDT file",
          type: GDT_ERROR_TYPES.EMPTY_FILE,
        },
        isValid: false,
      });
    });

    test("should reject file with unparseable first line", () => {
      const result = validateGdtContent("123");
      expect(result).toEqual({
        error: {
          message: "First line could not be parsed",
          type: GDT_ERROR_TYPES.PARSE_ERROR,
        },
        isValid: false,
      });
    });

    test("should reject file without SATZ_START", () => {
      const content = `0143102Franz
014300012345
0158402BDM_01
014921802.10`;
      const result = validateGdtContent(content);
      expect(result).toEqual({
        error: {
          field: "SATZ_START",
          message: "Missing or invalid Satzart",
          type: GDT_ERROR_TYPES.MISSING_FIELD,
        },
        isValid: false,
      });
    });

    test("should reject file missing PATIENT_ID", () => {
      const content = `01380006310
0143102Franz
0158402BDM_01
014921802.10`;
      const result = validateGdtContent(content);
      expect(result).toEqual({
        error: {
          field: "PATIENT_ID",
          message: "Missing patient ID (FK 3000)",
          type: GDT_ERROR_TYPES.MISSING_FIELD,
        },
        isValid: false,
      });
    });

    test("should reject file missing TEST_PROCEDURE", () => {
      const content = `01380006310
014300012345
0143102Franz
014921802.10`;
      const result = validateGdtContent(content);
      expect(result).toEqual({
        error: {
          field: "TEST_PROCEDURE",
          message: "Missing test/procedure identifier (FK 8402)",
          type: GDT_ERROR_TYPES.MISSING_FIELD,
        },
        isValid: false,
      });
    });

    test("should reject file missing VERSION", () => {
      const content = `01380006310
014300012345
0143102Franz
0158402BDM_01`;
      const result = validateGdtContent(content);
      expect(result).toEqual({
        error: {
          field: "VERSION",
          message: "Missing GDT version (FK 0001 or FK 9218)",
          type: GDT_ERROR_TYPES.MISSING_FIELD,
        },
        isValid: false,
      });
    });

    test("should accept file with VERSION field instead of VERSION_ALT", () => {
      const content = `01380006310
014300012345
0143102Franz
0158402BDM_01
01000012.10`;
      const result = validateGdtContent(content);
      expect(result).toEqual({ isValid: true });
    });

    test("should handle windows line endings", () => {
      const contentWithCrlf = validGdtContent.replaceAll("\n", "\r\n");
      const result = validateGdtContent(contentWithCrlf);
      expect(result).toEqual({ isValid: true });
    });

    test("should handle mixed line endings", () => {
      const lines = validGdtContent.split("\n");
      const mixedContent =
        lines.slice(0, 3).join("\r\n") + "\n" + lines.slice(3).join("\n");
      const result = validateGdtContent(mixedContent);
      expect(result).toEqual({ isValid: true });
    });
  });

  describe("parseGdtContent", () => {
    test("should parse valid GDT content into fields", () => {
      const result = parseGdtContent(validGdtContent);

      expect(result.length).toBeGreaterThan(0);

      // Check first field (SATZ_START)
      expect(result[0]).toEqual({
        content: "6310",
        fieldId: "8000",
        length: 13,
      });

      // Check that SATZ_END is automatically added if missing
      const lastField = result[result.length - 1];
      expect(lastField).toBeDefined();
      expect(lastField?.fieldId).toBe(GDT_FIELD_IDS.SATZ_END);
      expect(lastField?.content).toBe("6310");
    });

    test("should handle empty content", () => {
      const result = parseGdtContent("");
      expect(result).toEqual([
        {
          content: "6310",
          fieldId: GDT_FIELD_IDS.SATZ_END,
          length: 13,
        },
      ]);
    });

    test("should handle content without SATZ_END", () => {
      const content = `01380006310
014300012345`;
      const result = parseGdtContent(content);

      expect(result.length).toBe(3);
      expect(result[2]).toEqual({
        content: "6310",
        fieldId: GDT_FIELD_IDS.SATZ_END,
        length: 13,
      });
    });

    test("should not add SATZ_END if already present", () => {
      const content = `01380006310
014300012345
01380016310`;
      const result = parseGdtContent(content);

      expect(result.length).toBe(3);
      expect(result[2]).toEqual({
        content: "6310",
        fieldId: GDT_FIELD_IDS.SATZ_END,
        length: 13,
      });
    });

    test("should filter out invalid lines", () => {
      const content = `01380006310
invalid
014300012345
toolshort`;
      const result = parseGdtContent(content);

      expect(result.length).toBe(3); // 2 valid + auto-added SATZ_END
      expect(result[0]?.fieldId).toBe("8000");
      expect(result[1]?.fieldId).toBe("3000");
      expect(result[2]?.fieldId).toBe(GDT_FIELD_IDS.SATZ_END);
    });

    test("should handle windows line endings", () => {
      const content = "01380006310\r\n014300012345";
      const result = parseGdtContent(content);

      expect(result.length).toBe(3);
      expect(result[0]?.fieldId).toBe("8000");
      expect(result[1]?.fieldId).toBe("3000");
    });
  });

  describe("extractPatientData", () => {
    test("should extract patient data from valid GDT fields", () => {
      const fields = parseGdtContent(validGdtContent);
      const result = extractPatientData(fields);

      expect(result).toEqual({
        city: "34567 Musterhausen",
        dateOfBirth: "1945-10-01",
        firstName: "Franz",
        lastName: "Mustermann",
        patientId: 12_345,
        street: "Musterstrasse 12",
      });
    });

    test("should handle missing optional fields", () => {
      const fields = [
        { content: "6310", fieldId: GDT_FIELD_IDS.SATZ_START, length: 13 },
        { content: "12345", fieldId: GDT_FIELD_IDS.PATIENT_ID, length: 14 },
        { content: "Mustermann", fieldId: GDT_FIELD_IDS.LAST_NAME, length: 19 },
      ];
      const result = extractPatientData(fields);

      expect(result).toEqual({
        lastName: "Mustermann",
        patientId: 12_345,
      });
    });

    test("should handle invalid patient ID", () => {
      const fields = [
        { content: "6310", fieldId: GDT_FIELD_IDS.SATZ_START, length: 13 },
        { content: "invalid", fieldId: GDT_FIELD_IDS.PATIENT_ID, length: 14 },
        { content: "Mustermann", fieldId: GDT_FIELD_IDS.LAST_NAME, length: 19 },
      ];
      const result = extractPatientData(fields);

      expect(result).toEqual({
        lastName: "Mustermann",
        patientId: 0, // Default value when parsing fails
      });
    });

    test("should handle invalid birth date", () => {
      const fields = [
        { content: "6310", fieldId: GDT_FIELD_IDS.SATZ_START, length: 13 },
        { content: "12345", fieldId: GDT_FIELD_IDS.PATIENT_ID, length: 14 },
        { content: "Mustermann", fieldId: GDT_FIELD_IDS.LAST_NAME, length: 19 },
        { content: "invalid", fieldId: GDT_FIELD_IDS.BIRTH_DATE, length: 17 },
      ];
      const result = extractPatientData(fields);

      expect(result).toEqual({
        lastName: "Mustermann",
        patientId: 12_345,
        // dateOfBirth should not be included due to invalid date
      });
    });

    test("should handle empty fields array", () => {
      const result = extractPatientData([]);

      expect(result).toEqual({
        patientId: 0,
      });
    });

    test("should handle patient ID with whitespace", () => {
      const fields = [
        { content: "6310", fieldId: GDT_FIELD_IDS.SATZ_START, length: 13 },
        { content: " 12345 ", fieldId: GDT_FIELD_IDS.PATIENT_ID, length: 14 },
      ];
      const result = extractPatientData(fields);

      expect(result).toEqual({
        patientId: 12_345,
      });
    });

    test("should handle all supported field types", () => {
      const fields = [
        { content: "6310", fieldId: GDT_FIELD_IDS.SATZ_START, length: 13 },
        { content: "12345", fieldId: GDT_FIELD_IDS.PATIENT_ID, length: 14 },
        { content: "Franz", fieldId: GDT_FIELD_IDS.FIRST_NAME, length: 14 },
        { content: "Mustermann", fieldId: GDT_FIELD_IDS.LAST_NAME, length: 19 },
        { content: "01101945", fieldId: GDT_FIELD_IDS.BIRTH_DATE, length: 17 },
        {
          content: "Musterstrasse 12",
          fieldId: GDT_FIELD_IDS.STREET,
          length: 25,
        },
        {
          content: "34567 Musterhausen",
          fieldId: GDT_FIELD_IDS.CITY,
          length: 27,
        },
      ];
      const result = extractPatientData(fields);

      expect(result).toEqual({
        city: "34567 Musterhausen",
        dateOfBirth: "1945-10-01",
        firstName: "Franz",
        lastName: "Mustermann",
        patientId: 12_345,
        street: "Musterstrasse 12",
      });
    });
  });

  describe("Integration Tests", () => {
    test("should handle complete parsing workflow with valid GDT", () => {
      // Test the complete workflow
      const validation = validateGdtContent(validGdtContent);
      expect(validation.isValid).toBe(true);

      const fields = parseGdtContent(validGdtContent);
      expect(fields.length).toBeGreaterThan(0);

      const patientData = extractPatientData(fields);
      expect(patientData.patientId).toBe(12_345);
      expect(patientData.firstName).toBe("Franz");
      expect(patientData.lastName).toBe("Mustermann");
    });

    test("should handle minimal valid GDT file", () => {
      const minimalGdt = `01380006310
014300012345
0158402BDM_01
014921802.10`;

      const validation = validateGdtContent(minimalGdt);
      expect(validation.isValid).toBe(true);

      const fields = parseGdtContent(minimalGdt);
      const patientData = extractPatientData(fields);
      expect(patientData.patientId).toBe(12_345);
    });

    test("should handle GDT with alternative version field", () => {
      const gdtWithVersionAlt = `01380006310
014300012345
0158402BDM_01
01000012.10`;

      const validation = validateGdtContent(gdtWithVersionAlt);
      expect(validation.isValid).toBe(true);
    });
  });

  describe("Error Handling with Modified GDT Files", () => {
    test("should handle GDT file with corrupted line length", () => {
      const corruptedGdt =
        "abc80006310\n014300012345\n0158402BDM_01\n014921802.10";

      const validation = validateGdtContent(corruptedGdt);
      expect(validation.isValid).toBe(false);
      if (!validation.isValid) {
        expect((validation as { error: { type: string } }).error.type).toBe(
          GDT_ERROR_TYPES.PARSE_ERROR,
        );
      }
    });

    test("should handle GDT file with line too short", () => {
      const corruptedGdt = "0138000\n014300012345\n0158402BDM_01\n014921802.10";

      const validation = validateGdtContent(corruptedGdt);
      expect(validation.isValid).toBe(false);
      if (!validation.isValid) {
        expect((validation as { error: { type: string } }).error.type).toBe(
          GDT_ERROR_TYPES.PARSE_ERROR,
        );
      }
    });

    test("should handle GDT file with wrong field order", () => {
      // Start with TEST_PROCEDURE instead of SATZ_START
      const wrongOrderGdt =
        "0158402BDM_01\n01380006310\n014300012345\n014921802.10";

      const validation = validateGdtContent(wrongOrderGdt);
      expect(validation.isValid).toBe(false);
      if (!validation.isValid) {
        expect((validation as { error: { field: string } }).error.field).toBe(
          "SATZ_START",
        );
      }
    });

    test("should handle GDT file with special characters in patient names", () => {
      const specialCharsGdt =
        "01380006310\n014300012345\n0223102Müller-Weiß\n0293101Björn-Ärger\n0158402BDM_01\n014921802.10";

      const validation = validateGdtContent(specialCharsGdt);
      expect(validation.isValid).toBe(true);

      const fields = parseGdtContent(specialCharsGdt);
      const patientData = extractPatientData(fields);
      expect(patientData.firstName).toBe("Müller-Weiß");
      expect(patientData.lastName).toBe("Björn-Ärger");
    });

    test("should handle GDT file with mixed valid and invalid lines", () => {
      const mixedGdt =
        "01380006310\ninvalid_line\n014300012345\ntoo_short\n0143102Franz\nabc800invalid\n0158402BDM_01\n014921802.10\nanother_invalid";

      const validation = validateGdtContent(mixedGdt);
      expect(validation.isValid).toBe(true);

      const fields = parseGdtContent(mixedGdt);
      // Should only parse valid lines
      const validFields = fields.filter(
        (f) => f.fieldId !== GDT_FIELD_IDS.SATZ_END,
      );
      expect(validFields.length).toBe(5); // SATZ_START, PATIENT_ID, FIRST_NAME, TEST_PROCEDURE, VERSION_ALT
    });

    test("should handle GDT file with duplicate patient ID", () => {
      // This should still be valid as we just take the last occurrence
      const duplicateIdGdt =
        "01380006310\n014300012345\n0143102Franz\n014300067890\n0158402BDM_01\n014921802.10";

      const validation = validateGdtContent(duplicateIdGdt);
      expect(validation.isValid).toBe(true);

      const fields = parseGdtContent(duplicateIdGdt);
      const patientData = extractPatientData(fields);
      expect(patientData.patientId).toBe(67_890); // Should use the last occurrence
    });

    test("should handle GDT file with zero patient ID", () => {
      const zeroIdGdt = "01380006310\n01030001\n0158402BDM_01\n014921802.10";

      const validation = validateGdtContent(zeroIdGdt);
      expect(validation.isValid).toBe(false);
      if (!validation.isValid) {
        expect((validation as { error: { field: string } }).error.field).toBe(
          "PATIENT_ID",
        ); // Should fail because patient ID field is missing (wrong field ID)
      }
    });

    test("should handle GDT file with valid zero patient ID", () => {
      const zeroIdGdt = "01380006310\n01030000\n0158402BDM_01\n014921802.10";

      const fields = parseGdtContent(zeroIdGdt);
      const patientData = extractPatientData(fields);
      expect(patientData.patientId).toBe(0);
    });

    test("should handle GDT file with negative patient ID", () => {
      const negativeIdGdt =
        "01380006310\n0143000-123\n0158402BDM_01\n014921802.10";

      const validation = validateGdtContent(negativeIdGdt);
      expect(validation.isValid).toBe(true);

      const fields = parseGdtContent(negativeIdGdt);
      const patientData = extractPatientData(fields);
      expect(patientData.patientId).toBe(-123);
    });

    test("should handle GDT file with only invalid lines after SATZ_START", () => {
      const invalidLinesGdt = "01380006310\ninvalid\ntoo_short\nabc123def";

      const validation = validateGdtContent(invalidLinesGdt);
      expect(validation.isValid).toBe(false);
      if (!validation.isValid) {
        expect((validation as { error: { field: string } }).error.field).toBe(
          "PATIENT_ID",
        ); // Should fail on missing required fields
      }
    });
  });
});

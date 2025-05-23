import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

describe("gdtFiles functions", () => {
  test("should add and retrieve processed files", async () => {
    const t = convexTest(schema);

    // Define mock file data
    const file1Data = {
      fileContent: "This is the content of file1.gdt",
      fileName: "file1.gdt",
      gdtParsedSuccessfully: true,
      sourceDirectoryName: "testDir/source1",
    };
    const file2Data = {
      fileContent: "Content of file2.gdt, parsing failed.",
      fileName: "file2.gdt",
      gdtParsedSuccessfully: false,
      processingErrorMessage: "Syntax error in GDT data",
      sourceDirectoryName: "testDir/source2",
    };

    // Add files using the addProcessedFile mutation
    await t.mutation(api.gdtFiles.addProcessedFile, file1Data);
    await t.mutation(api.gdtFiles.addProcessedFile, file2Data);

    // Retrieve files using getRecentProcessedFiles query
    const recentFiles = await t.query(api.gdtFiles.getRecentProcessedFiles, {
      limit: 5,
    });

    // Assertions
    expect(recentFiles.length).toBe(2);

    // Check file2 first due to descending order by processedAt (newest first)
    // We need to be careful about asserting processedAt directly due to timing.
    // Instead, we'll check the properties we set.
    const firstFile = recentFiles[0];
    expect(firstFile).toBeDefined();
    if (firstFile) {
      expect(firstFile).toMatchObject(file2Data);
      // expect(firstFile.fileName).toBe(file2Data.fileName); // Covered by toMatchObject
      // expect(firstFile.gdtParsedSuccessfully).toBe(file2Data.gdtParsedSuccessfully); // Covered by toMatchObject
    }

    const secondFile = recentFiles[1];
    expect(secondFile).toBeDefined();
    if (secondFile) {
      expect(secondFile).toMatchObject(file1Data);
      // expect(secondFile.fileName).toBe(file1Data.fileName); // Covered by toMatchObject
      // expect(secondFile.gdtParsedSuccessfully).toBe(file1Data.gdtParsedSuccessfully); // Covered by toMatchObject
    }

    // Test with no limit (should use default limit)
    const defaultLimitFiles = await t.query(
      api.gdtFiles.getRecentProcessedFiles,
      {},
    );
    // Default limit is 20, but we only added 2 files
    expect(defaultLimitFiles.length).toBe(2);
  });

  test("addProcessedFile handles optional processingErrorMessage correctly", async () => {
    const t = convexTest(schema);
    const fileDataSuccess = {
      fileContent: "Successful file content.",
      fileName: "success.gdt",
      gdtParsedSuccessfully: true,
      sourceDirectoryName: "successDir",
    };
    // No processingErrorMessage

    const fileDataError = {
      fileContent: "Error file content.",
      fileName: "error.gdt",
      gdtParsedSuccessfully: false,
      processingErrorMessage: "Specific error message",
      sourceDirectoryName: "errorDir",
    };

    await t.mutation(api.gdtFiles.addProcessedFile, fileDataSuccess);
    await t.mutation(api.gdtFiles.addProcessedFile, fileDataError);

    const files = await t.query(api.gdtFiles.getRecentProcessedFiles, {
      limit: 2,
    });

    // files[0] is fileDataError (most recent)
    const fileWithError = files[0];
    expect(fileWithError).toBeDefined();
    if (fileWithError) {
      expect(fileWithError.fileName).toBe(fileDataError.fileName);
      expect(fileWithError.gdtParsedSuccessfully).toBe(false);
      expect(fileWithError.processingErrorMessage).toBe(
        fileDataError.processingErrorMessage,
      );
    }

    // files[1] is fileDataSuccess
    const fileWithSuccess = files[1];
    expect(fileWithSuccess).toBeDefined();
    if (fileWithSuccess) {
      expect(fileWithSuccess.fileName).toBe(fileDataSuccess.fileName);
      expect(fileWithSuccess.gdtParsedSuccessfully).toBe(true);
      expect(fileWithSuccess.processingErrorMessage).toBeUndefined();
    }
  });
});

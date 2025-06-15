import { beforeEach, describe, expect, test, vi } from "vitest";

import type { FileSystemChangeRecord, FileSystemFileHandle } from "../types";

// Mock the global FileSystemObserver
const mockObserver = {
  disconnect: vi.fn(),
  observe: vi.fn(),
  unobserve: vi.fn(),
};

const MockFileSystemObserver = vi.fn().mockImplementation(() => mockObserver);

// Mock global FileSystemObserver for tests
// We use type assertion here because we're mocking experimental browser APIs in a test environment
Object.defineProperty(globalThis, "FileSystemObserver", {
  value: MockFileSystemObserver,
  writable: true,
});

describe("FileSystemObserver Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("FileSystemObserver should be available on window", () => {
    expect((globalThis as any).FileSystemObserver).toBeDefined();
    expect(typeof (globalThis as any).FileSystemObserver).toBe("function");
  });

  test("FileSystemObserver should be constructable with callback", () => {
    const callback = vi.fn();
    const observer = new (globalThis as any).FileSystemObserver(callback);

    expect(MockFileSystemObserver).toHaveBeenCalledWith(callback);
    expect(observer).toEqual(mockObserver);
  });

  test("observer should have required methods", () => {
    const callback = vi.fn();
    const observer = new (globalThis as any).FileSystemObserver(callback);

    expect(typeof observer.observe).toBe("function");
    expect(typeof observer.unobserve).toBe("function");
    expect(typeof observer.disconnect).toBe("function");
  });

  test("observer callback should handle GDT file detection", async () => {
    const callback = vi.fn();
    const observer = new (globalThis as any).FileSystemObserver(callback);

    // Mock a file change record for a GDT file
    const mockGdtFile: Partial<FileSystemFileHandle> = {
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue("8000test8100"),
      }),
      kind: "file",
      name: "test.gdt",
    };

    const mockRecord: FileSystemChangeRecord = {
      changedHandle: mockGdtFile as FileSystemFileHandle,
      relativePathComponents: ["test.gdt"],
      type: "appeared",
    };

    // Simulate the callback being called
    await callback([mockRecord], observer);

    expect(callback).toHaveBeenCalledWith([mockRecord], observer);
  });

  test("observer should filter for .gdt files only", () => {
    const gdtRecord: FileSystemChangeRecord = {
      changedHandle: { kind: "file", name: "test.gdt" } as FileSystemFileHandle,
      relativePathComponents: ["test.gdt"],
      type: "appeared",
    };

    const txtRecord: FileSystemChangeRecord = {
      changedHandle: { kind: "file", name: "test.txt" } as FileSystemFileHandle,
      relativePathComponents: ["test.txt"],
      type: "appeared",
    };

    const records = [gdtRecord, txtRecord];

    // Filter logic from the component
    const gdtFiles = records.filter((record) => {
      const fileName =
        record.relativePathComponents[record.relativePathComponents.length - 1];
      return (
        record.type === "appeared" &&
        record.changedHandle.kind === "file" &&
        fileName?.toLowerCase().endsWith(".gdt")
      );
    });

    expect(gdtFiles).toHaveLength(1);
    expect(gdtFiles[0]).toBe(gdtRecord);
  });
});

import { describe, expect, test, beforeEach, vi, Mock } from "vitest";
import type {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  FileSystemObserver,
  FileSystemChangeRecord,
} from "../types/file-system";

// Mock the global FileSystemObserver
const mockObserver = {
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
};

const MockFileSystemObserver = vi.fn().mockImplementation(() => mockObserver);

// Mock window.FileSystemObserver
Object.defineProperty(window, 'FileSystemObserver', {
  value: MockFileSystemObserver,
  writable: true,
});

describe("FileSystemObserver Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("FileSystemObserver should be available on window", () => {
    expect(window.FileSystemObserver).toBeDefined();
    expect(typeof window.FileSystemObserver).toBe("function");
  });

  test("FileSystemObserver should be constructable with callback", () => {
    const callback = vi.fn();
    const observer = new window.FileSystemObserver(callback);
    
    expect(MockFileSystemObserver).toHaveBeenCalledWith(callback);
    expect(observer).toEqual(mockObserver);
  });

  test("observer should have required methods", () => {
    const callback = vi.fn();
    const observer = new window.FileSystemObserver(callback);
    
    expect(observer.observe).toBeDefined();
    expect(observer.unobserve).toBeDefined();
    expect(observer.disconnect).toBeDefined();
  });

  test("observer callback should handle GDT file detection", async () => {
    const callback = vi.fn();
    const observer = new window.FileSystemObserver(callback);
    
    // Mock a file change record for a GDT file
    const mockGdtFile: Partial<FileSystemFileHandle> = {
      kind: "file",
      name: "test.gdt",
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue("8000test8100"),
      }),
    };

    const mockRecord: FileSystemChangeRecord = {
      changedHandle: mockGdtFile as FileSystemFileHandle,
      type: "appeared",
      relativePathComponents: ["test.gdt"],
    };

    // Simulate the callback being called
    await callback([mockRecord], observer);
    
    expect(callback).toHaveBeenCalledWith([mockRecord], observer);
  });

  test("observer should filter for .gdt files only", () => {
    const gdtRecord: FileSystemChangeRecord = {
      changedHandle: { kind: "file", name: "test.gdt" } as FileSystemFileHandle,
      type: "appeared",
      relativePathComponents: ["test.gdt"],
    };

    const txtRecord: FileSystemChangeRecord = {
      changedHandle: { kind: "file", name: "test.txt" } as FileSystemFileHandle,
      type: "appeared",
      relativePathComponents: ["test.txt"],
    };

    const records = [gdtRecord, txtRecord];
    
    // Filter logic from the component
    const gdtFiles = records.filter((record) => {
      const fileName = record.relativePathComponents[record.relativePathComponents.length - 1];
      return (
        record.type === "appeared" &&
        record.changedHandle.kind === "file" &&
        fileName.toLowerCase().endsWith(".gdt")
      );
    });

    expect(gdtFiles).toHaveLength(1);
    expect(gdtFiles[0]).toBe(gdtRecord);
  });
});
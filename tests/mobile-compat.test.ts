import { afterEach, describe, expect, it, vi } from "vitest";
import { readBlobAsArrayBuffer, readBlobBytes } from "@/lib/files/browser-file";
import { ensurePromiseWithResolvers, needsLegacyPdfJs } from "@/lib/pdf/compatibility";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mobile browser file compatibility", () => {
  it("uses Blob.arrayBuffer when the browser provides it", async () => {
    const bytes = await readBlobBytes(new Blob([new Uint8Array([1, 2, 3])]));
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("falls back to FileReader when Blob.arrayBuffer is unavailable", async () => {
    class FileReaderFallback {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      readAsArrayBuffer() {
        this.result = new Uint8Array([4, 5, 6]).buffer;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("FileReader", FileReaderFallback);
    const oldWebKitBlob = { arrayBuffer: undefined } as unknown as Blob;

    expect([...new Uint8Array(await readBlobAsArrayBuffer(oldWebKitBlob))]).toEqual([4, 5, 6]);
  });
});

describe("PDF.js compatibility", () => {
  it("installs Promise.withResolvers before using the legacy bundle", async () => {
    const original = Object.getOwnPropertyDescriptor(Promise, "withResolvers");
    try {
      Object.defineProperty(Promise, "withResolvers", {
        configurable: true,
        writable: true,
        value: undefined,
      });
      expect(needsLegacyPdfJs()).toBe(true);
      ensurePromiseWithResolvers();
      const capability = Promise.withResolvers<number>();
      capability.resolve(42);
      await expect(capability.promise).resolves.toBe(42);
    } finally {
      if (original) Object.defineProperty(Promise, "withResolvers", original);
      else Reflect.deleteProperty(Promise, "withResolvers");
    }
  });
});

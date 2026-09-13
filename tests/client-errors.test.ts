import { describe, expect, it, vi } from "vitest";
import { errorMessage, UserFacingError, validateFile } from "../src/lib/files/validation";
import { conversionResponseMessage } from "../src/lib/conversion/client-errors";

describe("document error messages", () => {
  it("retains validation guidance but hides arbitrary exceptions and logs the original stack", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = new TypeError("undefined is not a function");
      expect(errorMessage(failure, "Please try again.")).toBe("Please try again.");
      expect(log).toHaveBeenCalledWith("Document operation failed", failure);
      expect(errorMessage(new Error("private detail"), "Please try again.")).toBe(
        "Please try again.",
      );
      expect(errorMessage(new UserFacingError("Choose a PDF."))).toBe("Choose a PDF.");
      expect(() => validateFile({ name: "test.txt", type: "text/plain", size: 10 }, "pdf")).toThrow(
        UserFacingError,
      );
    } finally {
      log.mockRestore();
    }
  });

  it("maps known server codes to guidance without echoing server strings", () => {
    expect(conversionResponseMessage({ code: "OCR_REQUIRED", error: "private" })).toContain("OCR");
    for (const body of [
      null,
      "private",
      { code: "PROCESSING_ERROR", error: "private" },
      { code: "toString" },
    ]) {
      expect(conversionResponseMessage(body)).toBe(
        "The server couldn’t convert this document. Please try again.",
      );
    }
  });
});

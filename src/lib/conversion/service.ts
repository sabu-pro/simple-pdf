import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { conversionConfig } from "./config";
import { wordToPdf } from "./libreoffice";
import { runProcess } from "./process";
import { ConversionError } from "./errors";

export type ConversionDirection = "word-to-pdf" | "pdf-to-word";
export type ConversionResult = {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  warnings: string[];
};

type ConversionStatus = {
  ok: boolean;
  code?: string;
  message?: string;
  emptyPages?: number[];
  warnings?: string[];
  engine?: "pdf2docx";
};
export interface DocumentConversionService {
  convert(
    direction: ConversionDirection,
    input: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<ConversionResult>;
}

export async function pdfToWordAvailable() {
  try {
    await runProcess(
      process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3"),
      ["-c", "import pdf2docx, pymupdf, docx"],
      5000,
    );
    return true;
  } catch {
    return false;
  }
}

export class LocalDocumentConversionService implements DocumentConversionService {
  async convert(
    direction: ConversionDirection,
    input: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<ConversionResult> {
    const config = conversionConfig();
    if (direction === "word-to-pdf")
      return {
        bytes: await wordToPdf(input, directory, config.timeoutMs, signal),
        mime: "application/pdf",
        filename: "converted.pdf",
        warnings: [
          "Check the layout before sharing. Fonts and complex Word formatting may change during conversion.",
        ],
      };
    const output = path.join(directory, "converted.docx"),
      statusFile = path.join(directory, "status.json");
    let status: ConversionStatus;
    try {
      await runProcess(
        process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3"),
        [
          path.resolve("scripts/conversion/pdf_to_word.py"),
          input,
          output,
          statusFile,
          String(config.maxPages),
        ],
        config.timeoutMs,
        { signal },
      );
      status = JSON.parse(await readFile(statusFile, "utf8"));
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : "";
      if (/not found|not recognized|ENOENT/i.test(message))
        throw new ConversionError(
          "PDF to Word needs the free pdf2docx service on this server. Install the Python requirements, then restart SimplePDF.",
          "PDF_TO_WORD_ENGINE_UNAVAILABLE",
          503,
        );
      throw error;
    }
    try {
      if (!status) throw new Error("Missing status");
    } catch {
      throw new ConversionError(
        "The conversion did not finish correctly. Please try again.",
        "CONVERSION_FAILED",
      );
    }
    if (status.code === "PYTHON_DEPENDENCIES")
      throw new ConversionError(
        "PDF to Word needs the free pdf2docx package on this server. Install the Python requirements, then restart SimplePDF.",
        "PDF_TO_WORD_ENGINE_UNAVAILABLE",
        503,
      );
    if (!status.ok)
      throw new ConversionError(
        status.message || "This PDF could not be converted.",
        status.code || "CONVERSION_FAILED",
      );
    if ((await stat(output)).size > 100 * 1024 * 1024)
      throw new ConversionError(
        "The converted document exceeds the output size limit.",
        "OUTPUT_TOO_LARGE",
      );
    const warnings = [
      "Complex PDF layouts may require minor formatting adjustments after conversion.",
      ...(status.warnings ?? []),
    ];
    if (status.emptyPages?.length)
      warnings.push(
        `${status.emptyPages.length} page(s) had no extractable text and may need OCR.`,
      );
    return {
      bytes: await readFile(output),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "converted.docx",
      warnings,
    };
  }
}
export const conversionService: DocumentConversionService = new LocalDocumentConversionService();

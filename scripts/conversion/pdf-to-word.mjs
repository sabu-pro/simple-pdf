import { writeFile } from "node:fs/promises";
import { extractPdfText } from "./extract-text.mjs";
import { generateDocx } from "./generate-docx.mjs";

const [input, output, statusFile, maxPages] = process.argv.slice(2);
try {
  const extracted = await extractPdfText(input, Number(maxPages));
  if (extracted.ocr.required) {
    await writeFile(
      statusFile,
      JSON.stringify({
        ok: false,
        code: "OCR_REQUIRED",
        message:
          "This PDF has no extractable text. It may be scanned or image-only and needs OCR, which is not included in this version.",
      }),
    );
  } else {
    await writeFile(output, await generateDocx(extracted.pages));
    await writeFile(statusFile, JSON.stringify({ ok: true, emptyPages: extracted.ocr.emptyPages }));
  }
} catch (error) {
  const known = ["PAGE_LIMIT", "TEXT_LIMIT"].includes(error.code);
  await writeFile(
    statusFile,
    JSON.stringify({
      ok: false,
      code: known ? error.code : "INVALID_PDF",
      message: known
        ? error.message
        : "We couldn’t read the text in this PDF. It may be damaged or password protected.",
    }),
  );
}

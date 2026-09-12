import { PDFDocument } from "pdf-lib";
import { validateMagic } from "@/lib/files/validation";

export async function loadPdf(bytes: Uint8Array) {
  validateMagic(bytes, "pdf");
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    if (!document.getPageCount()) throw new Error("No pages");
    return document;
  } catch {
    throw new Error("We couldn’t process this PDF. It may be damaged or password protected.");
  }
}
export async function mergePdfs(files: Uint8Array[]) {
  if (files.length < 2) throw new Error("Add at least two PDFs to merge.");
  const output = await PDFDocument.create();
  for (const bytes of files) {
    const source = await loadPdf(bytes);
    if (output.getPageCount() + source.getPageCount() > 2000)
      throw new Error("Merge up to 2,000 pages at a time.");
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return output.save();
}

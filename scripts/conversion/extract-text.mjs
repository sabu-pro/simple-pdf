import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import path from "node:path";
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;

/** OCR boundary: no inferred text is returned for pages without a text layer. */
export function assessOcr(pages) {
  const emptyPages = pages.flatMap((page, index) => (page.paragraphs.length ? [] : [index + 1]));
  return { required: emptyPages.length === pages.length, emptyPages };
}

export function groupTextItems(items, viewport, util) {
  const positioned = items
    .filter((item) => "str" in item && item.str.trim())
    .map((item) => {
      const matrix = util.transform(viewport.transform, item.transform);
      return {
        text: item.str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""),
        x: matrix[4],
        y: matrix[5],
        width: item.width,
        size: Math.max(6, Math.min(72, Math.hypot(matrix[2], matrix[3]))),
        font: item.fontName,
      };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const item of positioned) {
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - item.y) <= Math.max(2, item.size * 0.25))
      previous.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  const paragraphs = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let text = "",
      right = -Infinity;
    for (const item of line.items) {
      text +=
        text &&
        item.x - right > item.size * 0.12 &&
        !text.endsWith(" ") &&
        !item.text.startsWith(" ")
          ? " " + item.text
          : item.text;
      right = item.x + item.width;
    }
    const size = line.items.reduce((sum, item) => sum + item.size, 0) / line.items.length;
    const indent = line.items[0].x;
    const previous = paragraphs.at(-1);
    if (
      previous &&
      line.y - previous.lastY < size * 1.5 &&
      Math.abs(previous.indent - indent) < 16 &&
      Math.abs(previous.size - size) < 1.5
    ) {
      previous.text += " " + text;
      previous.lastY = line.y;
    } else paragraphs.push({ text, size, indent, lastY: line.y });
  }
  return paragraphs;
}

export async function extractPdfText(input, maxPages = 300) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = path.resolve("node_modules/pdfjs-dist").replaceAll("\\", "/");
  const task = pdfjs.getDocument({
    data: new Uint8Array(await readFile(input)),
    stopAtErrors: true,
    useSystemFonts: true,
    standardFontDataUrl: root + "/standard_fonts/",
    cMapUrl: root + "/cmaps/",
    cMapPacked: true,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > maxPages)
      throw Object.assign(new Error(`Convert up to ${maxPages} pages at a time.`), {
        code: "PAGE_LIMIT",
      });
    const pages = [];
    let characters = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index),
        viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const paragraphs = groupTextItems(content.items, viewport, pdfjs.Util);
      characters += paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0);
      if (characters > 2_000_000)
        throw Object.assign(new Error("This PDF has too much text for one conversion."), {
          code: "TEXT_LIMIT",
        });
      pages.push({ width: viewport.width, height: viewport.height, paragraphs });
      page.cleanup();
    }
    return { pages, ocr: assessOcr(pages) };
  } finally {
    await task.destroy();
  }
}

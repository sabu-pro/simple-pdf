import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type PdfTextBlock = {
  id: string;
  pageIndex: number;
  text: string;
  /** Rotation-aware page coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Baseline used to position the live SVG preview. */
  baselineX: number;
  baselineY: number;
  localTop: number;
  localHeight: number;
  advance: number;
  position: { x: number; y: number };
  transform: [number, number, number, number, number, number];
  fontName?: string;
  fontFamily?: string;
  fontSize: number;
  rotation: number;
  direction: "ltr" | "rtl" | "ttb" | "unknown";
};

export type PdfTextPageModel = {
  index: number;
  width: number;
  height: number;
  blocks: PdfTextBlock[];
};

export type PdfTextLayerModel = {
  pageCount: number;
  totalPages: number;
  isScanned: boolean;
  pages: Record<number, PdfTextPageModel>;
};

type TextStyle = {
  ascent?: number;
  descent?: number;
  fontFamily?: string;
};

function multiplyTransforms(first: number[], second: number[]) {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ] as [number, number, number, number, number, number];
}

function normalizeText(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

type TextSegment = { text: string; start: number; end: number };

function splitDecorativeLineRuns(value: string): TextSegment[] {
  const raw = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const runs = [...raw.matchAll(/[_\u2017\u203e\u2500-\u2501]{2,}/gu)];
  if (!runs.length) {
    const text = normalizeText(raw);
    return text ? [{ text, start: 0, end: raw.length }] : [];
  }

  const segments: TextSegment[] = [];
  const add = (start: number, end: number) => {
    const part = raw.slice(start, end);
    const leading = part.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = part.match(/\s*$/u)?.[0].length ?? 0;
    const visibleStart = start + leading;
    const visibleEnd = Math.max(visibleStart, end - trailing);
    const text = raw.slice(visibleStart, visibleEnd);
    if (text) segments.push({ text, start: visibleStart, end: visibleEnd });
  };

  let cursor = 0;
  for (const run of runs) {
    const start = run.index ?? cursor;
    add(cursor, start);
    add(start, start + run[0].length);
    cursor = start + run[0].length;
  }
  add(cursor, raw.length);
  return segments;
}

function transformedBounds(
  baselineX: number,
  baselineY: number,
  width: number,
  top: number,
  bottom: number,
  angle: number,
) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const point = (localX: number, localY: number) => ({
    x: baselineX + localX * cos - localY * sin,
    y: baselineY + localX * sin + localY * cos,
  });
  const points = [point(0, top), point(width, top), point(width, bottom), point(0, bottom)];
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
  };
}

export async function extractTextPage(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<PdfTextPageModel> {
  const page: PDFPageProxy = await pdf.getPage(pageIndex + 1);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, TextStyle>;
    const blocks: PdfTextBlock[] = [];

    for (const item of content.items) {
      if (!("str" in item) || !("transform" in item)) continue;
      const segments = splitDecorativeLineRuns(item.str);
      if (!segments.length) continue;
      const transform = multiplyTransforms(viewport.transform, item.transform);
      const fontHeight = Math.max(1, Math.hypot(transform[2], transform[3]));
      const angle = Math.atan2(transform[1], transform[0]);
      const style = styles[item.fontName] ?? {};
      const ascent = Number.isFinite(style.ascent)
        ? Number(style.ascent)
        : Number.isFinite(style.descent)
          ? 1 + Number(style.descent)
          : 0.8;
      const descent = Number.isFinite(style.descent) ? Number(style.descent) : ascent - 1;
      const localTop = -ascent * fontHeight;
      const localBottom = -descent * fontHeight;
      const advance = Math.max(1, Math.abs(item.width));
      const sourceLength = Math.max(1, item.str.length);

      for (const segment of segments) {
        const startAdvance = (advance * segment.start) / sourceLength;
        const segmentAdvance = Math.max(
          1,
          (advance * (segment.end - segment.start)) / sourceLength,
        );
        const baselineX = transform[4] + Math.cos(angle) * startAdvance;
        const baselineY = transform[5] + Math.sin(angle) * startAdvance;
        const bounds = transformedBounds(
          baselineX,
          baselineY,
          segmentAdvance,
          localTop,
          localBottom,
          angle,
        );
        const segmentTransform: PdfTextBlock["transform"] = [
          transform[0],
          transform[1],
          transform[2],
          transform[3],
          baselineX,
          baselineY,
        ];

        blocks.push({
          id: `source-${pageIndex + 1}-${blocks.length}`,
          pageIndex,
          text: segment.text,
          ...bounds,
          baselineX,
          baselineY,
          localTop,
          localHeight: Math.max(1, localBottom - localTop),
          advance: segmentAdvance,
          position: { x: bounds.x, y: bounds.y },
          transform: segmentTransform,
          fontName: item.fontName,
          fontFamily: style.fontFamily,
          fontSize: fontHeight,
          rotation: (angle * 180) / Math.PI,
          direction:
            item.dir === "ltr" || item.dir === "rtl" || item.dir === "ttb" ? item.dir : "unknown",
        });
      }
    }

    return {
      index: pageIndex,
      width: viewport.width,
      height: viewport.height,
      blocks,
    };
  } finally {
    page.cleanup();
  }
}

export async function buildTextLayerModel(
  bytes: Uint8Array,
  pageIndex?: number,
): Promise<PdfTextLayerModel> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  }
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    stopAtErrors: true,
    useSystemFonts: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    wasmUrl: "/pdfjs/wasm/",
    verbosity: 0,
  });
  const pdf = await task.promise;
  try {
    const indexes = pageIndex === undefined ? [...Array(pdf.numPages).keys()] : [pageIndex];
    const pageModels = await Promise.all(indexes.map((index) => extractTextPage(pdf, index)));
    const pages = Object.fromEntries(pageModels.map((page) => [page.index, page]));
    return {
      pageCount: pdf.numPages,
      totalPages: pdf.numPages,
      isScanned: pageModels.every((page) => page.blocks.length === 0),
      pages,
    };
  } finally {
    await task.destroy();
  }
}

import { describe, expect, it } from "vitest";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDocument, degrees } from "pdf-lib";
import path from "node:path";
import { exportPdf } from "@/lib/pdf/export";
import type { Matrix } from "@/types/editor";

// Node-side canvas implementation for actual rendered-pixel placement checks.
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
describe("rendered signature placement", () => {
  it.each([0, 90, 180, 270])(
    "places the correct pixels on a cropped page rotated %i degrees",
    async (rotation) => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const source = await PDFDocument.create(),
        page = source.addPage([400, 500]);
      page.setCropBox(20, 30, 340, 400);
      page.setRotation(degrees(rotation));
      const bytes = await source.save();
      const originalTask = pdfjs.getDocument({ data: bytes.slice() });
      const original = await originalTask.promise,
        originalPage = await original.getPage(1),
        viewport = originalPage.getViewport({ scale: 1 });
      const image = createCanvas(80, 40),
        paint = image.getContext("2d");
      paint.fillStyle = "#ff0000";
      paint.fillRect(0, 0, 40, 40);
      paint.fillStyle = "#0000ff";
      paint.fillRect(40, 0, 40, 40);
      const output = await exportPdf(bytes, {
        version: 1,
        filename: "rotated.pdf",
        pageCount: 1,
        pages: {
          0: {
            width: viewport.width,
            height: viewport.height,
            rotation,
            transform: viewport.transform as Matrix,
          },
        },
        objects: [
          {
            id: "signature",
            type: "signature",
            pageIndex: 0,
            x: 35,
            y: 65,
            width: 80,
            height: 40,
            rotation: 0,
            opacity: 1,
            color: "#000000",
            dataUrl: image.toDataURL("image/png"),
          },
        ],
      });
      await originalTask.destroy();
      const root = path.resolve("node_modules/pdfjs-dist").replaceAll("\\", "/");
      const task = pdfjs.getDocument({
        data: output,
        standardFontDataUrl: root + "/standard_fonts/",
      });
      const result = await task.promise,
        resultPage = await result.getPage(1),
        resultViewport = resultPage.getViewport({ scale: 1 });
      const canvas = createCanvas(
        Math.ceil(resultViewport.width),
        Math.ceil(resultViewport.height),
      );
      // PDF.js accepts the Node canvas at runtime; its type is intentionally DOM-only.
      await resultPage.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
        viewport: resultViewport,
      }).promise;
      const context = canvas.getContext("2d");
      expect(Array.from(context.getImageData(40, 75, 1, 1).data)).toEqual([255, 0, 0, 255]);
      expect(Array.from(context.getImageData(105, 75, 1, 1).data)).toEqual([0, 0, 255, 255]);
      expect(Array.from(context.getImageData(25, 55, 1, 1).data)).toEqual([255, 255, 255, 255]);
      await task.destroy();
    },
  );
});

describe("rendered form marks", () => {
  it("exports tick, cross, dot, and circle marks as aligned vector content", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const source = await PDFDocument.create();
    source.addPage([240, 120]);
    const bytes = await source.save();
    const marks = (["tick", "cross", "dot", "circle"] as const).map((mark, index) => ({
      id: mark,
      type: "mark" as const,
      mark,
      pageIndex: 0,
      x: 20 + index * 50,
      y: 30,
      width: 30,
      height: 30,
      rotation: 0,
      opacity: 1,
      color: "#000000",
    }));
    const output = await exportPdf(bytes, {
      version: 1,
      filename: "marks.pdf",
      pageCount: 1,
      pages: {
        0: {
          width: 240,
          height: 120,
          rotation: 0,
          transform: [1, 0, 0, -1, 0, 120],
        },
      },
      objects: marks,
    });
    const task = pdfjs.getDocument({ data: output });
    const document = await task.promise;
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const context = canvas.getContext("2d");
    const isDark = (x: number, y: number) => context.getImageData(x * 2, y * 2, 1, 1).data[0] < 180;
    expect(isDark(31, 52)).toBe(true);
    expect(isDark(85, 45)).toBe(true);
    expect(isDark(135, 45)).toBe(true);
    expect(isDark(185, 34)).toBe(true);
    await task.destroy();
  });
});

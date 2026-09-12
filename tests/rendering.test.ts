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

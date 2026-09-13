import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { loadPdf, mergePdfs } from "@/lib/pdf/core";
import { validateFile, validateMagic } from "@/lib/files/validation";
import { createMarkObject, deserializeDocument, serializeDocument } from "@/lib/editor/model";
import {
  clientToPage,
  exportMatrix,
  applyMatrix,
  pdfToViewport,
  viewportToPdf,
} from "@/lib/editor/coordinates";
import { exportPdf } from "@/lib/pdf/export";
import { historyReducer } from "@/lib/editor/history";
import { buildTextLayerModel } from "@/lib/pdf/text-layer";
import {
  normalizeSourceReplacement,
  sourceReplacementDraft,
  validateSourceTextEdits,
} from "@/lib/pdf/source-edits";
import type { EditorDocument, PageGeometry } from "@/types/editor";

async function fixture(width = 612, height = 792) {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, height]).drawText("A real PDF document");
  return pdf.save();
}
const geometry: PageGeometry = {
  width: 612,
  height: 792,
  transform: [1, 0, 0, -1, 0, 792],
  rotation: 0,
};
describe("file validation", () => {
  it("validates extension, MIME, size and content independently", () => {
    expect(() =>
      validateFile({ name: "report.pdf", size: 10, type: "application/pdf" }, "pdf"),
    ).not.toThrow();
    expect(() =>
      validateFile({ name: "report.exe", size: 10, type: "application/pdf" }, "pdf"),
    ).toThrow("Choose");
    expect(() => validateFile({ name: "report.pdf", size: 10, type: "image/png" }, "pdf")).toThrow(
      "file type",
    );
    expect(() => validateFile({ name: "report.pdf", size: 100, type: "" }, "pdf", 50)).toThrow(
      "smaller",
    );
    expect(() => validateFile({ name: "empty.pdf", size: 0, type: "" }, "pdf")).toThrow("empty");
    expect(() => validateMagic(new TextEncoder().encode("not a pdf"), "pdf")).toThrow("contents");
  });
  it("parses real PDFs and rejects malformed ones", async () => {
    expect((await loadPdf(await fixture())).getPageCount()).toBe(1);
    await expect(loadPdf(new TextEncoder().encode("%PDF-1.7 damaged"))).rejects.toThrow("damaged");
  });
});
describe("merge", () => {
  it("preserves the supplied document order and page dimensions", async () => {
    const merged = await loadPdf(
      await mergePdfs([await fixture(300, 400), await fixture(600, 700)]),
    );
    expect(merged.getPages().map((page) => page.getSize())).toEqual([
      { width: 300, height: 400 },
      { width: 600, height: 700 },
    ]);
  });
  it("rejects missing and malformed inputs", async () => {
    await expect(mergePdfs([])).rejects.toThrow("at least two");
    await expect(mergePdfs([await fixture(), new Uint8Array([1, 2])])).rejects.toThrow();
  });
});
describe("coordinates", () => {
  it("maps zoomed client coordinates into page points", () => {
    expect(
      clientToPage({ x: 160, y: 220 }, { left: 10, top: 20, width: 306, height: 396 }, geometry),
    ).toEqual({ x: 300, y: 400 });
  });
  it.each([
    geometry,
    { width: 792, height: 612, transform: [0, 1, 1, 0, 0, 0], rotation: 90 },
    { width: 500, height: 700, transform: [-1, 0, 0, 1, 520, -30], rotation: 180 },
    { width: 700, height: 500, transform: [0, -1, -1, 0, 730, 520], rotation: 270 },
  ] as PageGeometry[])("round trips rotated/cropped coordinates ($rotation degrees)", (page) => {
    const point = { x: 125, y: 190 };
    expect(pdfToViewport(viewportToPdf(point, page), page)).toEqual(point);
    expect(applyMatrix(exportMatrix(page), { x: point.x, y: page.height - point.y })).toEqual(
      viewportToPdf(point, page),
    );
  });
});
describe("pdf text layer model", () => {
  it("extracts positioned text blocks from a real PDF page", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    page.drawText("Name: John Smith", { x: 60, y: 720, size: 18 });
    const model = await buildTextLayerModel(new Uint8Array(await pdf.save()), 0);
    expect(model.pages[0].blocks.length).toBeGreaterThan(0);
    const match = model.pages[0].blocks.find((block) => block.text.includes("John Smith"));
    expect(match).toBeDefined();
    expect(match?.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(match?.width).toBeGreaterThan(0);
    expect(match?.height).toBeGreaterThan(0);
  });
  it("separates underscore blanks from adjacent editable labels", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    page.drawText("Full Name:__________", { x: 60, y: 720, size: 12 });
    const model = await buildTextLayerModel(new Uint8Array(await pdf.save()), 0);
    const blocks = model.pages[0].blocks;
    const label = blocks.find((block) => block.text === "Full Name:");
    const blank = blocks.find((block) => block.text === "__________");
    expect(label).toBeDefined();
    expect(blank).toBeDefined();
    expect(blocks.some((block) => block.text === "Full Name:__________")).toBe(false);
    expect(blank!.x).toBeGreaterThan(label!.x);
    expect(Math.abs(blank!.y - label!.y)).toBeLessThan(1);
  });
  it("flags pages with no extractable text as scanned or image-only", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const model = await buildTextLayerModel(new Uint8Array(await pdf.save()), 0);
    expect(model.isScanned).toBe(true);
    expect(model.pages[0].blocks).toEqual([]);
  });
  it("keeps text bounds inside a rotated page and exposes its rendered angle", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    page.drawText("Rotated source text", { x: 60, y: 600, size: 16 });
    page.setRotation(degrees(90));
    const model = await buildTextLayerModel(new Uint8Array(await pdf.save()), 0);
    const block = model.pages[0].blocks.find((item) => item.text === "Rotated source text");
    expect(block).toBeDefined();
    expect(block!.x).toBeGreaterThanOrEqual(0);
    expect(block!.y).toBeGreaterThanOrEqual(0);
    expect(block!.x + block!.width).toBeLessThanOrEqual(model.pages[0].width + 0.01);
    expect(block!.y + block!.height).toBeLessThanOrEqual(model.pages[0].height + 0.01);
    expect(Math.abs(block!.rotation)).toBeCloseTo(90, 3);
  });
  it("validates bounded single-line source text edits", () => {
    expect(
      validateSourceTextEdits([
        {
          id: "source-1-0",
          pageIndex: 0,
          x: 60,
          y: 50,
          width: 120,
          height: 20,
          originalText: "Original",
          replacementText: "Replacement",
          deleted: false,
        },
      ]),
    ).toHaveLength(1);
    expect(() =>
      validateSourceTextEdits([
        {
          id: "source-1-0",
          pageIndex: 0,
          x: 60,
          y: 50,
          width: 120,
          height: 20,
          originalText: "Original",
          replacementText: "Two\nlines",
          deleted: false,
        },
      ]),
    ).toThrow("single line");
  });
  it("opens decorative blanks empty and removes only inherited line characters", () => {
    expect(sourceReplacementDraft("____________")).toBe("");
    expect(sourceReplacementDraft("Employee name")).toBe("Employee name");
    expect(normalizeSourceReplacement("____________", "____Sample_User____")).toBe("Sample_User");
    expect(normalizeSourceReplacement("Employee name", "_Sample User_")).toBe("_Sample User_");
  });
});
describe("editor model and export", () => {
  const model: EditorDocument = {
    version: 1,
    filename: "sample.pdf",
    pageCount: 1,
    pages: { 0: geometry },
    objects: [
      {
        id: "text-1",
        pageIndex: 0,
        type: "text",
        x: 50,
        y: 70,
        width: 180,
        height: 30,
        rotation: 0,
        opacity: 1,
        color: "#202d2b",
        content: "Added text",
        fontSize: 18,
        fontFamily: "Helvetica",
        bold: false,
        italic: false,
      },
    ],
  };
  it("serializes a document without losing overlay data", () => {
    expect(deserializeDocument(serializeDocument(model))).toEqual(model);
  });
  it("serializes supported form marks and rejects unknown mark types", () => {
    const marks = (["tick", "cross", "dot", "circle"] as const).map((mark, index) =>
      createMarkObject(mark, 0, 20 + index * 30, 100, "#202d2b"),
    );
    expect(
      deserializeDocument(serializeDocument({ ...model, objects: marks })).objects.map(
        (object) => object.type === "mark" && object.mark,
      ),
    ).toEqual(["tick", "cross", "dot", "circle"]);
    expect(() =>
      deserializeDocument(
        JSON.stringify({ ...model, objects: [{ ...marks[0], mark: "unknown" }] }),
      ),
    ).toThrow("mark");
  });
  it("rejects nonfinite coordinates and unsafe signature data", () => {
    expect(() =>
      deserializeDocument(
        JSON.stringify({ ...model, objects: [{ ...model.objects[0], x: null }] }),
      ),
    ).toThrow("Invalid editor object");
    expect(() =>
      deserializeDocument(
        JSON.stringify({
          ...model,
          objects: [{ ...model.objects[0], type: "signature", dataUrl: "javascript:alert(1)" }],
        }),
      ),
    ).toThrow("signature");
  });
  it("embeds text and a PNG signature into an actual PDF", async () => {
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const result = await exportPdf(await fixture(), {
      ...model,
      objects: [
        ...model.objects,
        {
          id: "sig",
          type: "signature",
          pageIndex: 0,
          x: 80,
          y: 600,
          width: 120,
          height: 40,
          rotation: 0,
          opacity: 1,
          color: "#202d2b",
          dataUrl,
        },
      ],
    });
    const pdf = await loadPdf(result);
    expect(pdf.getPageCount()).toBe(1);
    expect(result.byteLength).toBeGreaterThan(1000);
    expect(pdf.getPage(0).node.Resources()?.toString()).toContain("XObject");
  });
  it("exports added editor objects without rewriting unrelated source streams", async () => {
    const result = await exportPdf(await fixture(), model);
    const pdf = await loadPdf(result);
    expect(pdf.getPageCount()).toBe(1);
    expect(result.byteLength).toBeGreaterThan(1000);
  });
  it("keeps original crop and rotation on export", async () => {
    const pdf = await PDFDocument.create(),
      page = pdf.addPage([612, 792]);
    page.setCropBox(20, 30, 500, 700);
    page.setRotation(degrees(90));
    const output = await loadPdf(
      await exportPdf(await pdf.save(), {
        ...model,
        pages: { 0: { width: 700, height: 500, transform: [0, 1, 1, 0, -30, -20], rotation: 90 } },
      }),
    );
    expect(output.getPage(0).getCropBox()).toEqual({ x: 20, y: 30, width: 500, height: 700 });
    expect(output.getPage(0).getRotation().angle).toBe(90);
  });
});
describe("undo and redo", () => {
  it("restores changes and clears redo after a new edit", () => {
    let state = historyReducer(
      { past: [], present: [1], future: [] },
      { type: "commit", value: [1, 2] },
    );
    state = historyReducer(state, { type: "undo" });
    expect(state.present).toEqual([1]);
    state = historyReducer(state, { type: "redo" });
    expect(state.present).toEqual([1, 2]);
    state = historyReducer(state, { type: "undo" });
    state = historyReducer(state, { type: "commit", value: [3] });
    expect(state.future).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";
import { flattenAcroForm } from "@/lib/pdf/acroform";
import { exportEditedPdf } from "@/lib/pdf/edit-export";
import { exportPdf } from "@/lib/pdf/export";
import type { EditorDocument } from "@/types/editor";

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
vi.mock("@/lib/pdf/browser", () => ({
  openBrowserPdf: async (bytes: Uint8Array) => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    return pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
    }).promise;
  },
}));

const name = PDFName.of;
const model: EditorDocument = {
  version: 1,
  filename: "form.pdf",
  pageCount: 1,
  objects: [],
  pages: { 0: { width: 360, height: 240, rotation: 0, transform: [1, 0, 0, -1, 0, 240] } },
};

async function assertStatic(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.catalog.has(name("AcroForm"))).toBe(false);
  for (const page of pdf.getPages()) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      expect(pdf.context.lookup(ref, PDFDict).get(name("Subtype"))).not.toBe(name("Widget"));
    }
  }
  return pdf;
}

async function render(bytes: Uint8Array, pageNumber = 1, annotations = true) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
  });
  try {
    const document = await task.promise;
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
      viewport,
      annotationMode: annotations ? pdfjs.AnnotationMode.ENABLE : pdfjs.AnnotationMode.DISABLE,
    }).promise;
    const text = (await page.getTextContent()).items.flatMap((item) =>
      "str" in item ? [item.str] : [],
    );
    return { png: canvas.toBuffer("image/png"), text };
  } finally {
    await task.destroy();
  }
}

async function styledForm() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([360, 240]);
  const font = await pdf.embedFont(StandardFonts.TimesRomanBold);
  page.drawText("Employee name", { x: 20, y: 205, font, size: 14, color: rgb(0.1, 0.2, 0.3) });
  const field = pdf.getForm().createTextField("employee.name");
  field.setText("Alex Morgan");
  field.addToPage(page, {
    x: 20,
    y: 160,
    width: 220,
    height: 24,
    font,
    textColor: rgb(0.1, 0.2, 0.3),
    borderWidth: 0,
    backgroundColor: undefined,
  });
  field.setFontSize(14);
  field.updateAppearances(font);
  return { pdf, page, field, font };
}

describe("Edit AcroForm finalization", () => {
  it("makes a real filled form static without changing its existing appearances", async () => {
    const source = new Uint8Array(await readFile("tests/fixtures/complex-form.pdf"));
    const original = await PDFDocument.load(source);
    expect(original.getForm().getFields()).toHaveLength(9);
    const output = await exportEditedPdf(source, model);
    await assertStatic(output);
    const before = await render(source);
    const after = await render(output, 1, false);
    expect(after.png.equals(before.png)).toBe(true);
    expect(after.text.join(" ")).toContain("Alex Morgan");
    expect(after.text.join(" ")).toContain("Move primary work location to Sydney");
    if (process.env.PDF_FORM_QA_DIR) {
      await mkdir(process.env.PDF_FORM_QA_DIR, { recursive: true });
      await writeFile(path.join(process.env.PDF_FORM_QA_DIR, "form-static.pdf"), output);
      await writeFile(path.join(process.env.PDF_FORM_QA_DIR, "form-static.png"), after.png);
    }
  });

  it.each(["missing", "stale"])(
    "regenerates %s appearances from inherited font, size and color",
    async (state) => {
      const { pdf, field, font } = await styledForm();
      const form = pdf.getForm().acroForm.dict;
      form.set(name("DR"), pdf.context.obj({ Font: { OriginalBold: font.ref } }));
      form.set(name("DA"), PDFString.of("/OriginalBold 14 Tf 0.1 0.2 0.3 rg"));
      field.acroField.dict.delete(name("DA"));
      for (const widget of field.acroField.getWidgets()) widget.dict.delete(name("DA"));
      field.acroField.dict.set(name("V"), PDFString.of("Jordan Lee"));
      if (state === "missing") {
        for (const widget of field.acroField.getWidgets()) widget.dict.delete(name("AP"));
      } else {
        form.set(name("NeedAppearances"), PDFBool.True);
      }
      const output = await flattenAcroForm(await pdf.save({ updateFieldAppearances: false }));
      const saved = await assertStatic(output);
      const appearance = saved
        .getPage(0)
        .node.Resources()!
        .lookup(name("XObject"), PDFDict)
        .values()
        .map((ref) => saved.context.lookup(ref) as PDFRawStream)[0];
      const content = new TextDecoder().decode(decodePDFRawStream(appearance).decode());
      expect(content).toContain("/OriginalBold 14 Tf");
      expect(content).toContain("0.1 0.2 0.3 rg");
      const resources = appearance.dict.lookup(name("Resources"), PDFDict);
      expect(
        resources
          .lookup(name("Font"), PDFDict)
          .lookup(name("OriginalBold"), PDFDict)
          .get(name("BaseFont")),
      ).toBe(name("Times-Bold"));
      const after = await render(output, 1, false);
      expect(after.text).toContain("Jordan Lee");
      expect(after.text).not.toContain("Alex Morgan");
      if (process.env.PDF_FORM_QA_DIR) {
        await writeFile(path.join(process.env.PDF_FORM_QA_DIR, `form-${state}.pdf`), output);
        await writeFile(path.join(process.env.PDF_FORM_QA_DIR, `form-${state}.png`), after.png);
      }
    },
  );

  it("keeps repeated widgets, radio states, links, and rotated page placement", async () => {
    const { pdf, page, field, font } = await styledForm();
    const second = pdf.addPage([360, 240]);
    second.setCropBox(10, 20, 320, 200);
    second.setRotation(degrees(90));
    field.addToPage(second, { x: 40, y: 120, width: 220, height: 24, font, rotate: degrees(180) });
    field.updateAppearances(font);
    const radio = pdf.getForm().createRadioGroup("choice");
    radio.addOptionToPage("Yes", page, { x: 30, y: 80, width: 16, height: 16 });
    radio.addOptionToPage("No", page, { x: 70, y: 80, width: 16, height: 16 });
    radio.select("Yes");
    const link = pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [20, 20, 120, 40],
        A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.test") },
      }),
    );
    page.node.addAnnot(link);
    const source = await pdf.save();
    const output = await flattenAcroForm(source);
    const saved = await assertStatic(output);
    expect(saved.getPage(0).node.Annots()!.size()).toBe(1);
    expect(saved.getPage(1).getRotation().angle).toBe(90);
    expect(saved.getPage(1).getCropBox()).toEqual(second.getCropBox());
    for (const number of [1, 2]) {
      expect((await render(output, number)).png.equals((await render(source, number)).png)).toBe(
        true,
      );
    }
  });

  it("reuses an embedded font and its encoding when regenerating a stale value", async () => {
    const source = new Uint8Array(await readFile("tests/fixtures/embedded-form.pdf"));
    const original = await PDFDocument.load(source);
    const originalFont = original.catalog
      .lookup(name("AcroForm"), PDFDict)
      .lookup(name("DR"), PDFDict)
      .lookup(name("Font"), PDFDict)
      .lookup(name("OriginalBold"), PDFDict);
    const output = await flattenAcroForm(source);
    const saved = await assertStatic(output);
    const appearance = saved
      .getPage(0)
      .node.Resources()!
      .lookup(name("XObject"), PDFDict)
      .values()
      .map((ref) => saved.context.lookup(ref) as PDFRawStream)[0];
    const font = appearance.dict
      .lookup(name("Resources"), PDFDict)
      .lookup(name("Font"), PDFDict)
      .lookup(name("OriginalBold"), PDFDict);
    expect(font.get(name("BaseFont"))).toBe(originalFont.get(name("BaseFont")));
    const fontBytes = (dict: PDFDict) =>
      decodePDFRawStream(
        dict.lookup(name("FontDescriptor"), PDFDict).lookup(name("FontFile2")) as PDFRawStream,
      ).decode();
    expect(fontBytes(font)).toEqual(fontBytes(originalFont));
    const content = new TextDecoder().decode(decodePDFRawStream(appearance).decode());
    expect(content).toContain("/OriginalBold 14 Tf");
    expect(content).toContain("0.1 0.2 0.3 rg");
    const after = await render(output, 1, false);
    expect(after.text).toContain("Jordan Lee");
    expect(after.text).not.toContain("Alex Morgan");
    if (process.env.PDF_FORM_QA_DIR) {
      await writeFile(path.join(process.env.PDF_FORM_QA_DIR, "form-embedded.pdf"), output);
      await writeFile(path.join(process.env.PDF_FORM_QA_DIR, "form-embedded.png"), after.png);
    }
  });

  it("fits a nonzero transformed appearance box and preserves orphan widgets", async () => {
    const { pdf, field } = await styledForm();
    const widget = field.acroField.getWidgets()[0].dict;
    const appearance = pdf.context.flateStream("0 0 0 rg 10 20 50 30 re f", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [10, 20, 60, 50],
      Matrix: [0, 2, -2, 0, 100, 0],
    });
    widget.set(name("AP"), pdf.context.obj({ N: pdf.context.register(appearance) }));
    // A page can contain a valid widget omitted from the catalog field tree.
    pdf.catalog.delete(name("AcroForm"));
    const source = await pdf.save({ updateFieldAppearances: false });
    const output = await flattenAcroForm(source);
    await assertStatic(output);
    expect((await render(output)).png.equals((await render(source)).png)).toBe(true);
  });

  it("does not reveal hidden values or leave invisible interactive widgets", async () => {
    const { pdf, field } = await styledForm();
    field.acroField.getWidgets()[0].dict.set(name("F"), pdf.context.obj(2));
    const output = await flattenAcroForm(await pdf.save());
    await assertStatic(output);
    expect((await render(output)).text).not.toContain("Alex Morgan");
  });

  it("fails instead of flattening a missing value when the original font cannot encode it", async () => {
    const { pdf, field } = await styledForm();
    field.acroField.dict.set(name("V"), PDFString.of("\u4e2d\u6587"));
    pdf.getForm().acroForm.dict.set(name("NeedAppearances"), PDFBool.True);
    await expect(
      flattenAcroForm(await pdf.save({ updateFieldAppearances: false })),
    ).rejects.toThrow("original font");
  });

  it("leaves flat/scanned overlay exports and the shared Sign export unchanged", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([360, 240]);
    const source = await pdf.save();
    expect(await flattenAcroForm(source)).toBe(source);
    const overlay: EditorDocument = {
      ...model,
      objects: [
        {
          id: "added",
          type: "text",
          pageIndex: 0,
          x: 30,
          y: 50,
          width: 200,
          height: 30,
          rotation: 0,
          opacity: 1,
          color: "#202d2b",
          content: "Overlay unchanged",
          fontSize: 16,
          fontFamily: "Helvetica",
          bold: true,
          italic: false,
        },
      ],
    };
    expect(
      (await render(await exportEditedPdf(source, overlay))).png.equals(
        (await render(await exportPdf(source, overlay))).png,
      ),
    ).toBe(true);
    const form = await styledForm();
    const signed = await PDFDocument.load(await exportPdf(await form.pdf.save(), model));
    expect(signed.getForm().getFields()).toHaveLength(1);
    expect(signed.getPage(0).node.Annots()).toBeInstanceOf(PDFArray);
  });
});

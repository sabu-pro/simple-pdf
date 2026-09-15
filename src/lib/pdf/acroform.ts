import {
  concatTransformationMatrix,
  drawObject,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
} from "pdf-lib";
import { openBrowserPdf } from "./browser";
import { loadPdf } from "./core";
import { UserFacingError } from "@/lib/files/validation";

const name = PDFName.of;

function inherited(widget: PDFDict, key: string) {
  const visited = new Set<PDFDict>();
  let field: PDFDict | undefined = widget;
  while (field && !visited.has(field)) {
    visited.add(field);
    const value = field.lookup(name(key));
    if (value) return value;
    field = field.lookupMaybe(name("Parent"), PDFDict);
  }
}

function widgets(pdf: PDFDocument) {
  return pdf.getPages().flatMap((page) =>
    (page.node.Annots()?.asArray() ?? []).flatMap((ref) => {
      const widget = pdf.context.lookup(ref);
      return widget instanceof PDFDict && widget.lookup(name("Subtype")) === name("Widget")
        ? [{ page, ref, widget }]
        : [];
    }),
  );
}

function normalAppearance(widget: PDFDict) {
  const appearances = widget.lookupMaybe(name("AP"), PDFDict);
  const normal = appearances?.lookup(name("N"));
  if (normal instanceof PDFStream) return normal;
  if (normal instanceof PDFDict) {
    // Each radio widget has its own on/off state, even when its /V is inherited.
    const state = widget.lookup(name("AS")) ?? inherited(widget, "V");
    const stream = normal.lookup(state instanceof PDFName ? state : name("Off"));
    if (stream instanceof PDFStream) return stream;
  }
}

function visible(widget: PDFDict) {
  const flags = widget.lookupMaybe(name("F"), PDFNumber)?.asNumber() ?? 0;
  return !(flags & (1 | 2 | 32)); // Invisible, Hidden, NoView
}

function appearanceError() {
  return new UserFacingError(
    "A form field could not be made permanent with its original font. Save the filled form in a PDF viewer and try again.",
  );
}

async function generateAppearances(pdf: PDFDocument) {
  const acroform = pdf.catalog.lookupMaybe(name("AcroForm"), PDFDict);
  const needsAppearances = acroform?.lookup(name("NeedAppearances")) === PDFBool.True;
  const repair = widgets(pdf).filter(({ widget }) => {
    const type = inherited(widget, "FT");
    return (
      visible(widget) &&
      (type === name("Tx") || type === name("Ch")) &&
      (needsAppearances || !normalAppearance(widget)?.getContentsSize())
    );
  });
  if (!repair.length) return pdf;

  // PDF.js resolves inherited /DA and /DR plus the original appearance's font
  // resources, including embedded fonts and their encodings. A blanket pdf-lib
  // updateFieldAppearances() would substitute Helvetica here.
  acroform?.delete(name("NeedAppearances"));
  const document = await openBrowserPdf(await pdf.save({ updateFieldAppearances: false }));
  try {
    const ids = new Set(
      repair.map(({ ref }) => {
        if (!(ref instanceof PDFRef)) throw appearanceError();
        return `${ref.objectNumber}R${ref.generationNumber || ""}`;
      }),
    );
    for (let number = 1; number <= document.numPages; number++) {
      const annotations = await (await document.getPage(number)).getAnnotations();
      for (const annotation of annotations) {
        if (!ids.delete(annotation.id)) continue;
        // An explicit (unchanged) rotation also forces regeneration when /V
        // already contains the desired value but /AP is missing or stale.
        document.annotationStorage.setValue(annotation.id, {
          value: annotation.fieldValue ?? "",
          rotation: annotation.rotation ?? 0,
        });
      }
    }
    if (ids.size) throw appearanceError();
    const updated = await loadPdf(await document.saveDocument());
    if (
      updated.catalog.lookupMaybe(name("AcroForm"), PDFDict)?.lookup(name("NeedAppearances")) ===
      PDFBool.True
    ) {
      // PDF.js requests viewer regeneration when the font cannot encode a value.
      // Do not flatten an empty/stale appearance and silently lose that value.
      throw appearanceError();
    }
    return updated;
  } finally {
    await document.loadingTask.destroy();
  }
}

/** Finalize Edit downloads only. PDFs without widgets are returned byte-for-byte. */
export async function flattenAcroForm(bytes: Uint8Array): Promise<Uint8Array> {
  let pdf = await loadPdf(bytes);
  if (!widgets(pdf).length) return bytes;
  pdf = await generateAppearances(pdf);

  for (const { page, widget } of widgets(pdf)) {
    if (!visible(widget)) continue;
    const appearance = normalAppearance(widget);
    // An unsigned signature widget can legitimately have no appearance.
    if (!appearance && inherited(widget, "FT") === name("Sig") && !inherited(widget, "V")) continue;
    if (!appearance) throw appearanceError();

    const rect = widget.lookup(name("Rect"), PDFArray).asRectangle();
    const box = appearance.dict.lookup(name("BBox"), PDFArray).asRectangle();
    const matrix = appearance.dict.lookupMaybe(name("Matrix"), PDFArray);
    const [a, b, c, d, e, f] = matrix
      ? matrix.asArray().map((_, index) => matrix.lookup(index, PDFNumber).asNumber())
      : [1, 0, 0, 1, 0, 0];
    const corners = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
    const minX = Math.min(...corners.map(([x]) => x));
    const minY = Math.min(...corners.map(([, y]) => y));
    const width = Math.max(...corners.map(([x]) => x)) - minX;
    const height = Math.max(...corners.map(([, y]) => y)) - minY;
    if (rect.width === 0 || rect.height === 0) continue;
    if (!(width > 0 && height > 0)) throw appearanceError();
    const sx = rect.width / width;
    const sy = rect.height / height;
    const key = page.node.newXObject("FlatWidget", pdf.context.register(appearance));
    // Map the transformed appearance box into /Rect. This also handles rotated
    // widgets and nonzero appearance origins without changing the page geometry.
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(sx, 0, 0, sy, rect.x - sx * minX, rect.y - sy * minY),
      drawObject(key),
      popGraphicsState(),
    );
  }

  // Remove widgets by their annotation refs, including child and orphan widgets.
  // Links, comments, and other annotations retain their original objects.
  for (const { page, ref } of widgets(pdf)) {
    const annotations = page.node.Annots()!;
    const index = annotations.indexOf(ref);
    if (index !== undefined) annotations.remove(index);
    if (!annotations.size()) page.node.delete(name("Annots"));
  }
  pdf.catalog.delete(name("AcroForm"));
  return pdf.save({ updateFieldAppearances: false });
}

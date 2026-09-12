import {
  BlendMode,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from "pdf-lib";
import { loadPdf } from "./core";
import { exportMatrix } from "@/lib/editor/coordinates";
import { deserializeDocument, serializeDocument } from "@/lib/editor/model";
import type { EditorDocument } from "@/types/editor";

function color(hex: string) {
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}
export async function exportPdf(original: Uint8Array, input: EditorDocument) {
  const model = deserializeDocument(serializeDocument(input));
  const pdf = await loadPdf(original);
  if (pdf.getPageCount() !== model.pageCount)
    throw new Error("The PDF does not match the editor document.");
  const fonts = await Promise.all(
    [
      StandardFonts.Helvetica,
      StandardFonts.HelveticaBold,
      StandardFonts.HelveticaOblique,
      StandardFonts.HelveticaBoldOblique,
    ].map((name) => pdf.embedFont(name)),
  );
  for (const object of model.objects) {
    const page = pdf.getPage(object.pageIndex);
    const geometry = model.pages[object.pageIndex];
    if (!geometry) throw new Error("Please open the edited page before exporting.");
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...exportMatrix(geometry)));
    // Object local coordinates are top-left based; the page graphics state is upright.
    const angle = (-object.rotation * Math.PI) / 180;
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(
        Math.cos(angle),
        Math.sin(angle),
        -Math.sin(angle),
        Math.cos(angle),
        object.x,
        geometry.height - object.y,
      ),
    );
    if (object.type === "text") {
      const font = fonts[(object.bold ? 1 : 0) + (object.italic ? 2 : 0)];
      try {
        const lines = object.content.replace(/\r/g, "").split("\n");
        lines.forEach((line, index) =>
          page.drawText(line, {
            x: 0,
            y: -object.fontSize - index * object.fontSize * 1.2,
            size: object.fontSize,
            font,
            color: color(object.color),
            opacity: object.opacity,
          }),
        );
      } catch {
        throw new Error(
          "An added text box contains characters the editor font cannot export. Use Latin text or add those characters as a signature image.",
        );
      }
    } else if (object.type === "highlight") {
      page.drawRectangle({
        x: 0,
        y: -object.height,
        width: object.width,
        height: object.height,
        color: color(object.color),
        opacity: object.opacity,
        blendMode: BlendMode.Multiply,
      });
    } else if (object.type === "signature") {
      const image = object.dataUrl.startsWith("data:image/png")
        ? await pdf.embedPng(object.dataUrl)
        : await pdf.embedJpg(object.dataUrl);
      page.drawImage(image, {
        x: 0,
        y: -object.height,
        width: object.width,
        height: object.height,
        opacity: object.opacity,
        rotate: degrees(0),
      });
    } else {
      const maxX = Math.max(1, ...object.points.map((point) => point.x));
      const maxY = Math.max(1, ...object.points.map((point) => point.y));
      for (let i = 1; i < object.points.length; i++) {
        const start = object.points[i - 1],
          end = object.points[i];
        page.drawLine({
          start: { x: (start.x * object.width) / maxX, y: (-start.y * object.height) / maxY },
          end: { x: (end.x * object.width) / maxX, y: (-end.y * object.height) / maxY },
          thickness: object.strokeWidth,
          color: color(object.color),
          opacity: object.opacity,
        });
      }
    }
    page.pushOperators(popGraphicsState(), popGraphicsState());
  }
  return pdf.save();
}

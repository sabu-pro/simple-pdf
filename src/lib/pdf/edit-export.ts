import type { EditorDocument } from "@/types/editor";
import { flattenAcroForm } from "./acroform";
import { exportPdf } from "./export";

export async function exportEditedPdf(original: Uint8Array, model: EditorDocument) {
  // Finalize source form fields before drawing the editor's existing overlays.
  return exportPdf(await flattenAcroForm(original), model);
}

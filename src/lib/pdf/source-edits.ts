import type { SourceTextEdit } from "@/types/editor";

const MAX_EDITS = 500;
const MAX_TEXT_LENGTH = 2000;

function finite(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${name} in the text edit request.`);
  }
  return value;
}

export function validateSourceTextEdits(value: unknown): SourceTextEdit[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EDITS) {
    throw new Error(`Send between 1 and ${MAX_EDITS} text edits.`);
  }
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("Invalid text edit request.");
    const edit = candidate as Record<string, unknown>;
    const id = typeof edit.id === "string" ? edit.id : "";
    const originalText = typeof edit.originalText === "string" ? edit.originalText : "";
    const replacementText = typeof edit.replacementText === "string" ? edit.replacementText : "";
    if (!id || ids.has(id)) throw new Error("Each text edit must have a unique identifier.");
    ids.add(id);
    if (!originalText.trim() || originalText.length > MAX_TEXT_LENGTH)
      throw new Error("The selected source text is missing or too long.");
    if (replacementText.length > MAX_TEXT_LENGTH || /[\r\n]/.test(replacementText))
      throw new Error("Replacement text must be a single line of up to 2,000 characters.");
    if (edit.deleted !== true && !replacementText.trim())
      throw new Error("Enter replacement text or choose Delete.");
    const pageIndex = finite(edit.pageIndex, "page number");
    const x = finite(edit.x, "horizontal position");
    const y = finite(edit.y, "vertical position");
    const width = finite(edit.width, "text width");
    const height = finite(edit.height, "text height");
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 9999)
      throw new Error("Invalid page number in the text edit request.");
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x > 100000 || y > 100000)
      throw new Error("Invalid text bounds in the text edit request.");
    return {
      id,
      pageIndex,
      x,
      y,
      width,
      height,
      originalText,
      replacementText,
      deleted: edit.deleted === true,
      fontName: typeof edit.fontName === "string" ? edit.fontName.slice(0, 200) : undefined,
      fontFamily: typeof edit.fontFamily === "string" ? edit.fontFamily.slice(0, 200) : undefined,
      fontSize:
        typeof edit.fontSize === "number" && Number.isFinite(edit.fontSize)
          ? edit.fontSize
          : undefined,
      rotation:
        typeof edit.rotation === "number" && Number.isFinite(edit.rotation)
          ? edit.rotation
          : undefined,
      direction:
        edit.direction === "ltr" || edit.direction === "rtl" || edit.direction === "ttb"
          ? edit.direction
          : "unknown",
    } satisfies SourceTextEdit;
  });
}

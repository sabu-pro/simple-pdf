import type { EditorDocument, EditorObject, EditorTool } from "@/types/editor";

export function createObject(
  type: EditorTool,
  pageIndex: number,
  x: number,
  y: number,
  color: string,
  fontSize: number,
): EditorObject {
  const base = {
    id: crypto.randomUUID(),
    pageIndex,
    x,
    y,
    width: 190,
    height: fontSize * 1.4,
    rotation: 0,
    opacity: 1,
    color,
  };
  if (type === "draw")
    return { ...base, type, width: 1, height: 1, points: [{ x: 0, y: 0 }], strokeWidth: 2 };
  if (type === "highlight")
    return { ...base, type, width: 1, height: 1, opacity: 0.32, color: "#f5d83d" };
  return {
    ...base,
    type: "text",
    content: "Your text",
    fontSize,
    fontFamily: "Helvetica",
    bold: false,
    italic: false,
  };
}

export function serializeDocument(document: EditorDocument) {
  return JSON.stringify(document);
}
export function deserializeDocument(json: string): EditorDocument {
  const value = JSON.parse(json) as EditorDocument;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.filename !== "string" ||
    !Number.isInteger(value.pageCount) ||
    value.pageCount < 1 ||
    !value.pages ||
    !Array.isArray(value.objects) ||
    value.objects.length > 10000 ||
    (value.sourceTextEdits !== undefined && !Array.isArray(value.sourceTextEdits))
  )
    throw new Error("Invalid editor document.");
  for (const page of Object.values(value.pages)) {
    if (
      !page ||
      !Number.isFinite(page.width) ||
      page.width <= 0 ||
      !Number.isFinite(page.height) ||
      page.height <= 0 ||
      !Array.isArray(page.transform) ||
      page.transform.length !== 6 ||
      !page.transform.every(Number.isFinite)
    )
      throw new Error("Invalid page geometry.");
  }
  for (const object of value.objects) {
    if (
      !object ||
      typeof object.id !== "string" ||
      !["text", "draw", "highlight", "signature"].includes(object.type) ||
      !Number.isInteger(object.pageIndex) ||
      object.pageIndex < 0 ||
      object.pageIndex >= value.pageCount ||
      ![object.x, object.y, object.width, object.height, object.rotation, object.opacity].every(
        Number.isFinite,
      ) ||
      object.width <= 0 ||
      object.height <= 0 ||
      object.opacity < 0 ||
      object.opacity > 1 ||
      !/^#[0-9a-f]{6}$/i.test(object.color)
    )
      throw new Error("Invalid editor object.");
    if (
      object.type === "text" &&
      (typeof object.content !== "string" ||
        !Number.isFinite(object.fontSize) ||
        object.fontSize < 1 ||
        object.fontSize > 500 ||
        object.fontFamily !== "Helvetica" ||
        typeof object.bold !== "boolean" ||
        typeof object.italic !== "boolean")
    )
      throw new Error("Invalid text object.");
    if (
      object.type === "draw" &&
      (!Array.isArray(object.points) ||
        object.points.length < 1 ||
        object.points.length > 100000 ||
        !object.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ||
        !Number.isFinite(object.strokeWidth) ||
        object.strokeWidth <= 0)
    )
      throw new Error("Invalid drawing.");
    if (
      object.type === "signature" &&
      (typeof object.dataUrl !== "string" ||
        !/^data:image\/(png|jpeg);base64,[a-z0-9+/=]+$/i.test(object.dataUrl) ||
        object.dataUrl.length > 15_000_000)
    )
      throw new Error("Invalid signature image.");
  }
  return value;
}

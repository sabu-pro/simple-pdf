export type Matrix = [number, number, number, number, number, number];
export type Point = { x: number; y: number };
/** Units are PDF points in the displayed (rotation-aware) page, with origin at top left. */
export type PageGeometry = { width: number; height: number; transform: Matrix; rotation: number };
type BaseObject = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  color: string;
};
export type TextObject = BaseObject & {
  type: "text";
  content: string;
  fontSize: number;
  fontFamily: "Helvetica";
  bold: boolean;
  italic: boolean;
};
export type DrawObject = BaseObject & { type: "draw"; points: Point[]; strokeWidth: number };
export type HighlightObject = BaseObject & { type: "highlight" };
export type SignatureObject = BaseObject & { type: "signature"; dataUrl: string };
export type EditorObject = TextObject | DrawObject | HighlightObject | SignatureObject;
export type SourceTextEdit = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  originalText: string;
  replacementText: string;
  deleted: boolean;
  fontName?: string;
  fontFamily?: string;
  fontSize?: number;
  rotation?: number;
  direction?: "ltr" | "rtl" | "ttb" | "unknown";
};
export type EditorDocument = {
  version: 1;
  filename: string;
  pageCount: number;
  pages: Record<number, PageGeometry>;
  objects: EditorObject[];
  sourceTextEdits?: SourceTextEdit[];
};
export type EditorTool = "select" | "text" | "draw" | "highlight";

"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  MousePointer2,
  Type,
  PenLine,
  Highlighter,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Download,
  ChevronLeft,
  ChevronRight,
  Trash2,
  FileText,
  Check,
  Plus,
  Move,
  Maximize,
  Bold,
  Italic,
} from "lucide-react";
import { UploadZone } from "@/components/upload-zone";
import { Button, Busy, Notice, ToolHeading } from "@/components/ui";
import { loadPdf } from "@/lib/pdf/core";
import { openBrowserPdf } from "@/lib/pdf/browser";
import { exportPdf } from "@/lib/pdf/export";
import { applySourceTextEdits } from "@/lib/pdf/source-edit-client";
import { normalizeSourceReplacement, sourceReplacementDraft } from "@/lib/pdf/source-edits";
import { historyReducer } from "@/lib/editor/history";
import { createMarkObject, createObject } from "@/lib/editor/model";
import { clientToPage } from "@/lib/editor/coordinates";
import { extractTextPage, type PdfTextBlock, type PdfTextLayerModel } from "@/lib/pdf/text-layer";
import { downloadBytes, outputName } from "@/lib/files/download";
import { readBlobBytes } from "@/lib/files/browser-file";
import {
  errorMessage,
  PDF_LOAD_ERROR,
  UserFacingError,
  validateFile,
} from "@/lib/files/validation";
import type {
  EditorObject,
  EditorTool,
  MarkKind,
  PageGeometry,
  Point,
  SourceTextEdit,
} from "@/types/editor";
import { PdfPage } from "./pdf-page";
import { SignatureDialog } from "./signature-dialog";
import "./editor.css";

type Loaded = { filename: string; bytes: Uint8Array; pdf: PDFDocumentProxy };
type Gesture = {
  mode: "move" | "resize" | "draw" | "highlight";
  start: Point;
  object: EditorObject;
  points?: Point[];
};
type EditorState = { objects: EditorObject[]; sourceTextEdits: SourceTextEdit[] };

const MARK_OPTIONS = [
  { id: "tick", symbol: "✓", label: "Tick" },
  { id: "cross", symbol: "✕", label: "Cross" },
  { id: "dot", symbol: "•", label: "Dot" },
  { id: "circle", symbol: "○", label: "Circle" },
] as const satisfies ReadonlyArray<{ id: MarkKind; symbol: string; label: string }>;

function markLabel(mark: MarkKind) {
  return MARK_OPTIONS.find((option) => option.id === mark)?.label ?? "Mark";
}

function sourceEditFor(
  source: PdfTextBlock,
  replacementText: string,
  deleted: boolean,
): SourceTextEdit {
  return {
    id: source.id,
    pageIndex: source.pageIndex,
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    originalText: source.text,
    replacementText,
    deleted,
    fontName: source.fontName,
    fontFamily: source.fontFamily,
    fontSize: source.fontSize,
    rotation: source.rotation,
    direction: source.direction,
  };
}

function upsertSourceEdit(edits: SourceTextEdit[], value: SourceTextEdit) {
  return edits.some((edit) => edit.id === value.id)
    ? edits.map((edit) => (edit.id === value.id ? value : edit))
    : [...edits, value];
}

async function pdfLoadStage<T>(stage: string, operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`PDF editor failed during ${stage}`, error);
    throw error;
  }
}

export function Editor({ signing = false }: { signing?: boolean }) {
  const [loaded, setLoaded] = useState<Loaded>();
  const [pageIndex, setPageIndex] = useState(0),
    [scale, setScale] = useState(0.9);
  const [pages, setPages] = useState<Record<number, PageGeometry>>({});
  const [history, dispatch] = useReducer(historyReducer<EditorState>, {
    past: [],
    present: { objects: [], sourceTextEdits: [] },
    future: [],
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedSourceId, setSelectedSourceId] = useState<string>();
  const [sourceTextModel, setSourceTextModel] = useState<PdfTextLayerModel | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [draft, setDraft] = useState<EditorObject>();
  const [tool, setTool] = useState<EditorTool>("select");
  const [markKind, setMarkKind] = useState<MarkKind>("tick");
  const [markMenuOpen, setMarkMenuOpen] = useState(false);
  const [color, setColor] = useState("#202d2b"),
    [fontSize, setFontSize] = useState(18);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [busy, setBusy] = useState<"loading" | "exporting" | null>(null);
  const [error, setError] = useState(""),
    [success, setSuccess] = useState(false);
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const svg = useRef<SVGSVGElement>(null),
    workspace = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null),
    latestDraft = useRef<EditorObject | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const objects = history.present.objects;
  const sourceTextEdits = history.present.sourceTextEdits;
  const visibleObjects = draft
    ? objects.some((object) => object.id === draft.id)
      ? objects.map((object) => (object.id === draft.id ? draft : object))
      : [...objects, draft]
    : objects;
  const selected = visibleObjects.find((object) => object.id === selectedId);
  const geometry = pages[pageIndex];
  const sourceBlocks = useMemo(
    () => sourceTextModel?.pages[pageIndex]?.blocks ?? [],
    [pageIndex, sourceTextModel],
  );
  const selectedSourceText = sourceBlocks.find((block) => block.id === selectedSourceId);
  const sourceEdit = sourceTextEdits.find((edit) => edit.id === selectedSourceId);
  const hasChanges = objects.length > 0 || sourceTextEdits.length > 0;
  const onGeometry = useCallback(
    (index: number, value: PageGeometry) =>
      setPages((previous) => (previous[index] ? previous : { ...previous, [index]: value })),
    [],
  );
  const onRenderError = useCallback((message: string) => setError(message), []);

  useEffect(
    () => () => {
      void loaded?.pdf.loadingTask.destroy();
    },
    [loaded],
  );
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, select, dialog, [contenteditable=true]",
        )
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setDraft(undefined);
        setSelectedSourceId(undefined);
        setSourceDraft("");
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        dispatch({
          type: "commit",
          value: {
            objects: objects.filter((object) => object.id !== selectedId),
            sourceTextEdits,
          },
        });
        setSelectedId(undefined);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedSourceId) {
        event.preventDefault();
        const sourceText = sourceBlocks.find((block) => block.id === selectedSourceId);
        if (sourceText)
          dispatch({
            type: "commit",
            value: {
              objects,
              sourceTextEdits: upsertSourceEdit(
                sourceTextEdits,
                sourceEditFor(sourceText, "", true),
              ),
            },
          });
      }
      if (event.key === "Escape") {
        setMarkMenuOpen(false);
        setSelectedId(undefined);
        setSelectedSourceId(undefined);
        setSourceDraft("");
        setDraft(undefined);
        gesture.current = null;
      }
      if (
        selected &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) &&
        geometry
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const x = Math.max(
          0,
          Math.min(
            geometry.width - selected.width,
            selected.x +
              (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
          ),
        );
        const y = Math.max(
          0,
          Math.min(
            geometry.height - selected.height,
            selected.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
          ),
        );
        dispatch({
          type: "commit",
          value: {
            objects: objects.map((object) =>
              object.id === selected.id ? { ...object, x, y } : object,
            ),
            sourceTextEdits,
          },
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [objects, sourceTextEdits, selectedId, selected, geometry, selectedSourceId, sourceBlocks]);

  async function upload(files: File[]) {
    if (!files[0] || busy) return;
    if (
      hasChanges &&
      !window.confirm(
        "Open another PDF? Download your current edits first if you want to keep them.",
      )
    )
      return;
    setBusy("loading");
    setError("");
    setSuccess(false);
    setExportWarnings([]);
    let pendingPdf: PDFDocumentProxy | undefined;
    try {
      if (files.length !== 1)
        throw new UserFacingError("Open one PDF at a time. Use Merge PDF to combine files.");
      const file = files[0];
      validateFile(file, "pdf");
      const bytes = await pdfLoadStage("file reading", () => readBlobBytes(file));
      await pdfLoadStage("PDF validation", () => loadPdf(bytes));
      const pdf = await pdfLoadStage("PDF.js document loading", () => openBrowserPdf(bytes));
      pendingPdf = pdf;
      const firstTextPage = await pdfLoadStage("first-page text extraction", () =>
        extractTextPage(pdf, 0),
      );
      const { viewport } = await pdfLoadStage("first-page viewport setup", async () => {
        const first = await pdf.getPage(1);
        return { viewport: first.getViewport({ scale: 1 }) };
      });
      const model: PdfTextLayerModel = {
        pageCount: pdf.numPages,
        totalPages: pdf.numPages,
        isScanned: firstTextPage.blocks.length === 0,
        pages: { 0: firstTextPage },
      };
      setLoaded({ filename: file.name, bytes, pdf });
      pendingPdf = undefined;
      setPageIndex(0);
      setPages({});
      setSelectedId(undefined);
      setSelectedSourceId(undefined);
      setSourceTextModel(model);
      setSourceDraft("");
      setDraft(undefined);
      setMarkMenuOpen(false);
      dispatch({ type: "reset", value: { objects: [], sourceTextEdits: [] } });
      if (model.isScanned) {
        setError("This page appears to be scanned or image-based. Text editing requires OCR.");
      }
      setScale(
        Math.max(
          0.25,
          Math.min(
            1,
            (window.innerWidth < 800 ? window.innerWidth - 88 : window.innerWidth - 440) /
              viewport.width,
          ),
        ),
      );
      if (signing) setSignatureOpen(true);
    } catch (error) {
      setError(errorMessage(error, PDF_LOAD_ERROR));
      await pendingPdf?.loadingTask.destroy().catch(() => {});
    } finally {
      setBusy(null);
    }
  }
  function commit(value: EditorObject[]) {
    dispatch({ type: "commit", value: { objects: value, sourceTextEdits } });
    setSuccess(false);
  }
  function commitSourceTextEdits(value: SourceTextEdit[]) {
    dispatch({ type: "commit", value: { objects, sourceTextEdits: value } });
    setSuccess(false);
  }
  function updateSelected(patch: Partial<EditorObject>) {
    if (!selected) return;
    let next = { ...selected, ...patch } as EditorObject;
    if (
      next.type === "text" &&
      ("content" in patch || "fontSize" in patch || "bold" in patch || "italic" in patch)
    ) {
      const context = document.createElement("canvas").getContext("2d");
      if (context) {
        context.font = `${next.italic ? "italic " : ""}${next.bold ? "bold " : ""}${next.fontSize}px Arial`;
        const width = Math.max(
          30,
          ...next.content.split("\n").map((line) => context.measureText(line).width + 4),
        );
        next = { ...next, width: Math.min(width, geometry.width - next.x) };
      }
    }
    commit(objects.map((object) => (object.id === selected.id ? next : object)));
  }
  function addText() {
    if (!geometry) return;
    const object = createObject(
      "text",
      pageIndex,
      Math.min(40, geometry.width / 10),
      Math.min(50, geometry.height / 10),
      color,
      fontSize,
    );
    object.width = Math.min(object.width, geometry.width - object.x);
    commit([...objects, object]);
    setSelectedId(object.id);
    setTool("select");
  }
  function insertSignature(dataUrl: string, ratio: number) {
    const page = pages[pageIndex];
    if (!page) return;
    const width = Math.min(180, page.width * 0.55, Math.max(20, page.height * 0.4 * ratio));
    const object: EditorObject = {
      id: crypto.randomUUID(),
      type: "signature",
      pageIndex,
      x: (page.width - width) / 2,
      y: Math.max(0, page.height * 0.55 - width / ratio / 2),
      width,
      height: width / ratio,
      rotation: 0,
      opacity: 1,
      color: "#202d2b",
      dataUrl,
    };
    commit([...objects, object]);
    setSelectedId(object.id);
    setTool("select");
  }
  function getPoint(event: React.PointerEvent) {
    return clientToPage(
      { x: event.clientX, y: event.clientY },
      svg.current!.getBoundingClientRect(),
      geometry,
    );
  }
  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!geometry || busy || event.button !== 0) return;
    const point = getPoint(event),
      target = event.target as Element;
    const id = target.closest("[data-object]")?.getAttribute("data-object");
    const sourceId = target.closest("[data-source-text]")?.getAttribute("data-source-text");
    if (tool === "select" && id) {
      const object = objects.find((item) => item.id === id)!;
      setSelectedId(id);
      setSelectedSourceId(undefined);
      gesture.current = {
        mode: target.hasAttribute("data-resize") ? "resize" : "move",
        start: point,
        object,
      };
    } else if (tool === "select" && sourceId) {
      setSelectedSourceId(sourceId);
      setSelectedId(undefined);
      const block = sourceBlocks.find((item) => item.id === sourceId);
      const edit = sourceTextEdits.find((item) => item.id === sourceId);
      setSourceDraft(
        edit?.deleted ? "" : sourceReplacementDraft(block?.text ?? "", edit?.replacementText),
      );
      gesture.current = null;
      event.preventDefault();
      return;
    } else if (tool === "text") {
      const object = createObject(
        "text",
        pageIndex,
        Math.min(point.x, Math.max(0, geometry.width - 190)),
        Math.min(point.y, geometry.height - fontSize * 1.4),
        color,
        fontSize,
      );
      object.width = Math.min(190, geometry.width - object.x);
      commit([...objects, object]);
      setSelectedId(object.id);
      setTool("select");
      return;
    } else if (tool === "mark") {
      const size = Math.max(16, Math.min(36, fontSize * 1.2));
      const object = createMarkObject(
        markKind,
        pageIndex,
        Math.max(0, Math.min(geometry.width - size, point.x - size / 2)),
        Math.max(0, Math.min(geometry.height - size, point.y - size / 2)),
        color,
        size,
      );
      commit([...objects, object]);
      setSelectedId(object.id);
      setSelectedSourceId(undefined);
      setTool("select");
      setMarkMenuOpen(false);
      return;
    } else if (tool === "draw" || tool === "highlight") {
      const object = createObject(tool, pageIndex, point.x, point.y, color, fontSize);
      gesture.current = {
        mode: tool,
        start: point,
        object,
        points: tool === "draw" ? [point] : undefined,
      };
      setSelectedId(object.id);
      setDraft(object);
      latestDraft.current = object;
    } else {
      setSelectedId(undefined);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    if (!active || !geometry) return;
    const point = getPoint(event),
      dx = point.x - active.start.x,
      dy = point.y - active.start.y;
    let next = { ...active.object };
    if (active.mode === "move")
      next = {
        ...next,
        x: Math.max(0, Math.min(geometry.width - next.width, next.x + dx)),
        y: Math.max(0, Math.min(geometry.height - next.height, next.y + dy)),
      };
    else if (active.mode === "resize") {
      const width = Math.min(geometry.width - next.x, Math.max(16, next.width + dx));
      const proportional =
        next.type === "signature" || next.type === "text" || next.type === "mark";
      const factor = Math.min(width / next.width, (geometry.height - next.y) / next.height);
      next = {
        ...next,
        width: proportional ? next.width * factor : width,
        height: proportional
          ? next.height * factor
          : Math.min(geometry.height - next.y, Math.max(8, next.height + dy)),
      };
      if (next.type === "text")
        next.fontSize = Math.max(
          4,
          Math.min(200, (active.object as typeof next).fontSize * factor),
        );
    } else if (active.mode === "highlight")
      next = {
        ...next,
        x: Math.min(active.start.x, point.x),
        y: Math.min(active.start.y, point.y),
        width: Math.max(1, Math.abs(dx)),
        height: Math.max(1, Math.abs(dy)),
      };
    else if (next.type === "draw") {
      const points = active.points!;
      if (points.length > 10000) return;
      if (Math.hypot(point.x - points.at(-1)!.x, point.y - points.at(-1)!.y) < 0.6) return;
      points.push(point);
      const x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
      next = {
        ...next,
        x,
        y,
        width: Math.max(1, Math.max(...points.map((p) => p.x)) - x),
        height: Math.max(1, Math.max(...points.map((p) => p.y)) - y),
        points: points.map((p) => ({ x: p.x - x, y: p.y - y })),
      };
    }
    latestDraft.current = next;
    setDraft(next);
  }
  function pointerUp() {
    const active = gesture.current,
      next = latestDraft.current;
    if (
      active &&
      next &&
      (next.type !== "draw" || next.points.length > 1) &&
      (active.mode !== "highlight" || (next.width > 2 && next.height > 2))
    ) {
      commit(
        objects.some((object) => object.id === next.id)
          ? objects.map((object) => (object.id === next.id ? next : object))
          : [...objects, next],
      );
    }
    gesture.current = null;
    latestDraft.current = undefined;
    setDraft(undefined);
  }
  async function download() {
    if (!loaded) return;
    setBusy("exporting");
    setError("");
    setSuccess(false);
    setExportWarnings([]);
    try {
      let sourceEdited = loaded.bytes;
      if (sourceTextEdits.length) {
        const result = await applySourceTextEdits(loaded.bytes, loaded.filename, sourceTextEdits);
        sourceEdited = result.bytes;
        setExportWarnings(result.warnings);
      }
      const bytes = await exportPdf(sourceEdited, {
        version: 1,
        filename: loaded.filename,
        pageCount: loaded.pdf.numPages,
        pages,
        objects,
      });
      downloadBytes(bytes, outputName(loaded.filename, signing ? "-signed" : "-edited"));
      setSuccess(true);
    } catch (error) {
      setError(errorMessage(error, "We couldn’t export this PDF. Please try again."));
    } finally {
      setBusy(null);
    }
  }
  function navigate(index: number) {
    setPageIndex(index);
    setSelectedId(undefined);
    setSelectedSourceId(undefined);
    setSourceDraft("");
    setDraft(undefined);
    gesture.current = null;
    latestDraft.current = undefined;
    if (loaded && sourceTextModel && !sourceTextModel.pages[index]) {
      void extractTextPage(loaded.pdf, index)
        .then((page) => {
          setSourceTextModel((current) =>
            current ? { ...current, pages: { ...current.pages, [index]: page } } : current,
          );
          if (!page.blocks.length)
            setError("This page appears to be scanned or image-based. Text editing requires OCR.");
        })
        .catch((error) => setError(errorMessage(error, "We couldn’t read text on this page.")));
    }
  }
  function fit() {
    if (geometry && workspace.current)
      setScale(Math.max(0.25, Math.min(2, (workspace.current.clientWidth - 48) / geometry.width)));
  }

  if (!loaded)
    return (
      <div className="tool-page page-width">
        <ToolHeading
          eyebrow={signing ? "A PERSONAL FINISHING TOUCH" : "YOUR DOCUMENT. YOUR FINISHING TOUCH."}
          title={signing ? "Sign your PDF. Simply." : "A little edit. A big difference."}
          description={
            signing
              ? "Draw, type or upload a signature. Place it on your document and download your signed PDF."
              : "Edit existing text or add notes, marks, highlights, drawings and signatures. Download a new PDF when you’re done."
          }
        />
        <UploadZone onFiles={(files) => void upload(files)} disabled={!!busy} />
        {busy && (
          <div className="text-center my-6">
            <Busy>Opening your PDF…</Busy>
          </div>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="editor-intro">
          <span>
            <Plus size={18} />
            Add the details that matter
          </span>
          <span>
            <Move size={18} />
            Move and resize your additions
          </span>
          <span>
            <Download size={18} />
            Download a new PDF
          </span>
        </div>
      </div>
    );

  return (
    <div className="editor-shell">
      <div className="editor-titlebar">
        <div className="min-w-0 flex items-center gap-3">
          <span className="tool-icon mint !m-0 !w-9 !h-9">
            <FileText size={19} />
          </span>
          <div className="min-w-0">
            <h1 className="file-name truncate text-sm" title={loaded.filename}>
              {loaded.filename}
            </h1>
            <p className="text-[10px] text-muted mt-1">
              {loaded.pdf.numPages} {loaded.pdf.numPages === 1 ? "page" : "pages"} · Original-text
              edits use temporary server processing
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept=".pdf,application/pdf"
            aria-label="Open another PDF"
            onChange={(event) => {
              if (event.target.files) void upload(Array.from(event.target.files));
              event.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            className="open-another"
            disabled={!!busy}
            onClick={() => input.current?.click()}
          >
            Open another
          </Button>
          <Button onClick={() => void download()} disabled={!!busy}>
            {busy === "exporting" ? (
              <Busy>Exporting…</Busy>
            ) : (
              <>
                <Download size={16} />
                <span>Download PDF</span>
              </>
            )}
          </Button>
        </div>
      </div>
      <div className="editor-toolbar" role="toolbar" aria-label="PDF editor tools">
        <div className="toolbar-group">
          {(
            [
              { id: "select", label: "Select", icon: MousePointer2 },
              { id: "text", label: "Text", icon: Type },
              { id: "draw", label: "Draw", icon: PenLine },
              { id: "highlight", label: "Highlight", icon: Highlighter },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`tool-button ${tool === item.id ? "active" : ""}`}
              aria-label={item.label}
              aria-pressed={tool === item.id}
              onClick={() => {
                setTool(item.id);
                setMarkMenuOpen(false);
                setSelectedId(undefined);
                setSelectedSourceId(undefined);
              }}
              disabled={!!busy}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
            </button>
          ))}
          <div className="mark-tool">
            <button
              className={`tool-button ${tool === "mark" ? "active" : ""}`}
              aria-label="Marks"
              aria-haspopup="menu"
              aria-expanded={markMenuOpen}
              aria-pressed={tool === "mark"}
              onClick={() => {
                setMarkMenuOpen((open) => !open);
                setSelectedId(undefined);
                setSelectedSourceId(undefined);
              }}
              disabled={!!busy}
            >
              <Check size={17} />
              <span>Marks</span>
            </button>
            {markMenuOpen && (
              <div className="mark-picker" role="menu" aria-label="Choose a mark">
                {MARK_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className="mark-option"
                    role="menuitem"
                    onClick={() => {
                      setMarkKind(option.id);
                      setTool("mark");
                      setMarkMenuOpen(false);
                    }}
                  >
                    <span className="mark-symbol" aria-hidden="true">
                      {option.symbol}
                    </span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="tool-button"
            aria-label="Signature"
            onClick={() => {
              setMarkMenuOpen(false);
              setSignatureOpen(true);
            }}
            disabled={!geometry || !!busy}
          >
            <PenLine size={17} />
            <span>Signature</span>
          </button>
        </div>
        <div className="toolbar-group">
          <button
            className="icon-btn"
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
            disabled={!history.past.length || !!busy}
            onClick={() => {
              setDraft(undefined);
              setSelectedSourceId(undefined);
              setSourceDraft("");
              dispatch({ type: "undo" });
            }}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-btn"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo"
            disabled={!history.future.length || !!busy}
            onClick={() => {
              setDraft(undefined);
              setSelectedSourceId(undefined);
              setSourceDraft("");
              dispatch({ type: "redo" });
            }}
          >
            <Redo2 size={18} />
          </button>
        </div>
        <div className="toolbar-group ml-auto">
          <button
            className="icon-btn"
            aria-label="Zoom out"
            disabled={scale <= 0.25}
            onClick={() => setScale(Math.max(0.25, scale - 0.1))}
          >
            <ZoomOut size={17} />
          </button>
          <span className="zoom-label" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          <button
            className="icon-btn"
            aria-label="Zoom in"
            disabled={scale >= 3}
            onClick={() => setScale(Math.min(3, scale + 0.1))}
          >
            <ZoomIn size={17} />
          </button>
          <button className="icon-btn" aria-label="Fit page to width" onClick={fit}>
            <Maximize size={16} />
          </button>
        </div>
      </div>
      {error && (
        <div className="px-5">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {success && (
        <div className="editor-success" role="status">
          <Check size={15} />
          Your PDF is ready. Your download has started.
        </div>
      )}
      {exportWarnings.map((warning) => (
        <div className="px-5" key={warning}>
          <Notice>{warning}</Notice>
        </div>
      ))}
      <div className="editor-body">
        <aside className="editor-sidebar" aria-label="Document pages">
          <div className="sidebar-label">
            PAGES <span>{loaded.pdf.numPages}</span>
          </div>
          <div className="page-list">
            {Array.from({ length: loaded.pdf.numPages }, (_, index) => (
              <button
                key={index}
                className={`page-list-item ${pageIndex === index ? "active" : ""}`}
                aria-label={`Go to page ${index + 1}`}
                aria-current={pageIndex === index ? "page" : undefined}
                onClick={() => navigate(index)}
              >
                <FileText size={24} strokeWidth={1.3} />
                <span>Page {index + 1}</span>
                {objects.some((object) => object.pageIndex === index) && (
                  <span className="page-edit-dot" title="Contains added objects" />
                )}
              </button>
            ))}
          </div>
          <p className="sidebar-hint">
            {signing
              ? "Your original content stays intact."
              : "Edit original text or add new content."}
          </p>
        </aside>
        <div className="editor-center">
          <div className="editor-context">
            <span>
              {tool === "select"
                ? "Select added content to move it, or existing text to edit it."
                : tool === "text"
                  ? "Click on the page to add text."
                  : tool === "draw"
                    ? "Drag on the page to draw."
                    : tool === "highlight"
                      ? "Drag across an area to highlight it."
                      : `Click on the page to place a ${markLabel(markKind).toLowerCase()}.`}
            </span>
            <span>Original PDF + your edits</span>
          </div>
          <div className="pdf-workspace" ref={workspace}>
            <div
              className="pdf-sheet"
              style={{
                width: geometry ? geometry.width * scale : undefined,
                height: geometry ? geometry.height * scale : undefined,
              }}
            >
              <PdfPage
                document={loaded.pdf}
                pageIndex={pageIndex}
                scale={scale}
                onGeometry={onGeometry}
                onError={onRenderError}
              />
              {geometry && (
                <svg
                  ref={svg}
                  className={`editor-overlay cursor-${tool}`}
                  viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                  role="group"
                  aria-label="Editable additions on this page"
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={() => {
                    gesture.current = null;
                    latestDraft.current = undefined;
                    setDraft(undefined);
                  }}
                >
                  {sourceBlocks.map((block) => {
                    const currentEdit = sourceTextEdits.find((edit) => edit.id === block.id);
                    const active = selectedSourceId === block.id;
                    const hasAppliedEdit =
                      !!currentEdit &&
                      (currentEdit.deleted || currentEdit.replacementText !== block.text);
                    const hasReplacement =
                      hasAppliedEdit &&
                      !!currentEdit &&
                      !currentEdit.deleted &&
                      !!currentEdit.replacementText;
                    return (
                      <g
                        key={block.id}
                        data-source-text={block.id}
                        transform={`translate(${block.baselineX} ${block.baselineY}) rotate(${block.rotation})`}
                        tabIndex={0}
                        role="button"
                        aria-label={`Existing PDF text: ${block.text}`}
                        aria-pressed={active}
                        onDoubleClick={() => {
                          setSelectedSourceId(block.id);
                          setSourceDraft(
                            currentEdit?.deleted
                              ? ""
                              : sourceReplacementDraft(block.text, currentEdit?.replacementText),
                          );
                          window.requestAnimationFrame(() => sourceInput.current?.focus());
                        }}
                        onFocus={() => {
                          setSelectedSourceId(block.id);
                          setSourceDraft(
                            currentEdit?.deleted
                              ? ""
                              : sourceReplacementDraft(block.text, currentEdit?.replacementText),
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedSourceId(block.id);
                            setSourceDraft(
                              currentEdit?.deleted
                                ? ""
                                : sourceReplacementDraft(block.text, currentEdit?.replacementText),
                            );
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        {hasReplacement && (
                          <rect
                            x={0}
                            y={block.localTop}
                            width={block.advance}
                            height={block.localHeight}
                            fill="white"
                          />
                        )}
                        <rect
                          x={0}
                          y={block.localTop}
                          width={block.advance}
                          height={block.localHeight}
                          fill={
                            hasAppliedEdit
                              ? "white"
                              : active
                                ? "rgba(8,126,101,0.10)"
                                : "transparent"
                          }
                          stroke={active ? "#087e65" : "transparent"}
                          strokeWidth={active ? 1.5 : 1}
                          rx={2}
                          ry={2}
                        />
                        {hasReplacement && currentEdit.replacementText && (
                          <text
                            x={0}
                            y={0}
                            fontFamily={block.fontFamily || "Arial, Helvetica, sans-serif"}
                            fontSize={block.fontSize}
                            fill="#111827"
                            textLength={block.advance}
                            lengthAdjust="spacingAndGlyphs"
                            aria-label={currentEdit.replacementText}
                          >
                            {currentEdit.replacementText}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {visibleObjects
                    .filter((object) => object.pageIndex === pageIndex)
                    .map((object) => {
                      const maxX =
                          object.type === "draw"
                            ? Math.max(1, ...object.points.map((p) => p.x))
                            : 1,
                        maxY =
                          object.type === "draw"
                            ? Math.max(1, ...object.points.map((p) => p.y))
                            : 1;
                      return (
                        <g
                          key={object.id}
                          data-object={object.id}
                          transform={`translate(${object.x} ${object.y}) rotate(${object.rotation})`}
                          tabIndex={0}
                          role="button"
                          aria-label={
                            object.type === "text"
                              ? `Text: ${object.content}`
                              : object.type === "mark"
                                ? `Mark: ${markLabel(object.mark)}`
                                : `${object.type} addition`
                          }
                          aria-pressed={selectedId === object.id}
                          onFocus={() => setSelectedId(object.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setTool("select");
                              setSelectedId(object.id);
                            }
                          }}
                        >
                          <rect width={object.width} height={object.height} fill="transparent" />
                          {object.type === "text" && (
                            <text
                              fontFamily="Arial, Helvetica, sans-serif"
                              fontSize={object.fontSize}
                              fontWeight={object.bold ? 700 : 400}
                              fontStyle={object.italic ? "italic" : "normal"}
                              fill={object.color}
                              opacity={object.opacity}
                              xmlSpace="preserve"
                            >
                              {object.content.split("\n").map((line, index) => (
                                <tspan
                                  key={index}
                                  x={0}
                                  y={object.fontSize + index * object.fontSize * 1.2}
                                >
                                  {line}
                                </tspan>
                              ))}
                            </text>
                          )}
                          {object.type === "highlight" && (
                            <rect
                              width={object.width}
                              height={object.height}
                              fill={object.color}
                              opacity={object.opacity}
                              style={{ mixBlendMode: "multiply" }}
                            />
                          )}
                          {object.type === "signature" && (
                            <image
                              href={object.dataUrl}
                              width={object.width}
                              height={object.height}
                              opacity={object.opacity}
                            />
                          )}
                          {object.type === "mark" && (
                            <svg
                              width={object.width}
                              height={object.height}
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              {object.mark === "tick" && (
                                <polyline
                                  points="3,12 9,18 21,5"
                                  fill="none"
                                  stroke={object.color}
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  opacity={object.opacity}
                                />
                              )}
                              {object.mark === "cross" && (
                                <g
                                  fill="none"
                                  stroke={object.color}
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                  opacity={object.opacity}
                                >
                                  <line x1="5" y1="5" x2="19" y2="19" />
                                  <line x1="19" y1="5" x2="5" y2="19" />
                                </g>
                              )}
                              {object.mark === "dot" && (
                                <circle
                                  cx="12"
                                  cy="12"
                                  r="4.5"
                                  fill={object.color}
                                  opacity={object.opacity}
                                />
                              )}
                              {object.mark === "circle" && (
                                <circle
                                  cx="12"
                                  cy="12"
                                  r="8.5"
                                  fill="none"
                                  stroke={object.color}
                                  strokeWidth="2.2"
                                  opacity={object.opacity}
                                />
                              )}
                            </svg>
                          )}
                          {object.type === "draw" && (
                            <polyline
                              points={object.points
                                .map(
                                  (point) =>
                                    `${(point.x * object.width) / maxX},${(point.y * object.height) / maxY}`,
                                )
                                .join(" ")}
                              fill="none"
                              stroke={object.color}
                              strokeWidth={object.strokeWidth}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              opacity={object.opacity}
                            />
                          )}
                          {selectedId === object.id && (
                            <>
                              <rect
                                width={object.width}
                                height={object.height}
                                fill="none"
                                stroke="#087e65"
                                strokeWidth={1 / scale}
                                strokeDasharray={`${4 / scale} ${2 / scale}`}
                                pointerEvents="none"
                              />
                              <rect
                                data-resize="true"
                                x={object.width - 5 / scale}
                                y={object.height - 5 / scale}
                                width={10 / scale}
                                height={10 / scale}
                                fill="white"
                                stroke="#087e65"
                                strokeWidth={1 / scale}
                                className="resize-handle"
                              />
                            </>
                          )}
                        </g>
                      );
                    })}
                </svg>
              )}
            </div>
          </div>
          <div className="page-navigation">
            <button
              className="icon-btn"
              aria-label="Previous page"
              disabled={pageIndex === 0}
              onClick={() => navigate(pageIndex - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              Page{" "}
              <select
                aria-label="Current page"
                value={pageIndex}
                onChange={(event) => navigate(Number(event.target.value))}
              >
                {Array.from({ length: loaded.pdf.numPages }, (_, index) => (
                  <option value={index} key={index}>
                    {index + 1}
                  </option>
                ))}
              </select>{" "}
              of {loaded.pdf.numPages}
            </span>
            <button
              className="icon-btn"
              aria-label="Next page"
              disabled={pageIndex === loaded.pdf.numPages - 1}
              onClick={() => navigate(pageIndex + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <aside className="properties-panel" aria-label="Object properties">
          <div className="sidebar-label">
            {selected ? `${selected.type.toUpperCase()} PROPERTIES` : "FINISHING TOUCHES"}
          </div>
          {!selected && !selectedSourceText ? (
            <>
              <p className="property-help">Add something new, then select it to make it yours.</p>
              <Button
                variant="secondary"
                className="w-full my-4"
                onClick={addText}
                disabled={!geometry}
              >
                <Plus size={16} />
                Add text
              </Button>
              <label className="field mb-4">
                Drawing / text / mark color
                <input
                  aria-label="Default color"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
              <label className="field">
                Text size
                <select
                  className="input"
                  value={fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value))}
                >
                  {[12, 14, 16, 18, 24, 32, 48].map((size) => (
                    <option key={size} value={size}>
                      {size} pt
                    </option>
                  ))}
                </select>
              </label>
              <p className="property-help mt-6">
                Choose Select, then click existing PDF text to replace or delete its original
                content. Scanned pages need OCR first.
              </p>
            </>
          ) : selected ? (
            <div className="space-y-4">
              {selected.type === "text" && (
                <>
                  <label className="field">
                    Text content
                    <textarea
                      aria-label="Text content"
                      className="input"
                      rows={5}
                      value={selected.content}
                      maxLength={10000}
                      onChange={(event) =>
                        updateSelected({
                          content: event.target.value,
                          height: Math.max(
                            selected.height,
                            (event.target.value.split("\n").length * 1.2 + 0.2) * selected.fontSize,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Font size (pt)
                    <input
                      className="input"
                      type="number"
                      min={4}
                      max={200}
                      value={Math.round(selected.fontSize)}
                      onChange={(event) => {
                        const size = Number(event.target.value);
                        if (size >= 4 && size <= 200)
                          updateSelected({
                            fontSize: size,
                            height: (selected.content.split("\n").length * 1.2 + 0.2) * size,
                          });
                      }}
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      className={`tool-button ${selected.bold ? "active" : ""}`}
                      aria-label="Bold text"
                      aria-pressed={selected.bold}
                      onClick={() => updateSelected({ bold: !selected.bold })}
                    >
                      <Bold size={16} />
                    </button>
                    <button
                      className={`tool-button ${selected.italic ? "active" : ""}`}
                      aria-label="Italic text"
                      aria-pressed={selected.italic}
                      onClick={() => updateSelected({ italic: !selected.italic })}
                    >
                      <Italic size={16} />
                    </button>
                  </div>
                </>
              )}
              {selected.type !== "signature" && (
                <label className="field">
                  Color
                  <input
                    type="color"
                    aria-label="Object color"
                    value={selected.color}
                    onChange={(event) => updateSelected({ color: event.target.value })}
                  />
                </label>
              )}
              {selected.type === "draw" && (
                <label className="field">
                  Line width
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={20}
                    value={selected.strokeWidth}
                    onChange={(event) => {
                      const width = Number(event.target.value);
                      if (width >= 1 && width <= 20) updateSelected({ strokeWidth: width });
                    }}
                  />
                </label>
              )}
              <label className="field">
                Width (pt)
                <input
                  className="input"
                  type="number"
                  min={8}
                  max={geometry?.width}
                  value={Math.round(selected.width)}
                  onChange={(event) => {
                    const width = Number(event.target.value);
                    if (width >= 8 && geometry && width <= geometry.width - selected.x)
                      updateSelected({
                        width,
                        ...(selected.type === "signature" || selected.type === "mark"
                          ? { height: (selected.height * width) / selected.width }
                          : {}),
                      });
                  }}
                />
              </label>
              <label className="field">
                Opacity
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(selected.opacity * 100)}
                  onChange={(event) =>
                    updateSelected({ opacity: Number(event.target.value) / 100 })
                  }
                />
              </label>
              <p className="property-help">
                Drag to move. Use the corner handle to resize. Arrow keys move by 1 pt; Shift moves
                by 10.
              </p>
              <Button
                variant="secondary"
                className="w-full !text-red-700"
                onClick={() => {
                  commit(objects.filter((object) => object.id !== selectedId));
                  setSelectedId(undefined);
                }}
              >
                <Trash2 size={15} />
                Delete addition
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="sidebar-label !text-[10px] !tracking-[0.2em]">EXISTING PDF TEXT</div>
              <p className="property-help">
                Selected: “{selectedSourceText?.text || sourceEdit?.originalText || ""}”
              </p>
              <label className="field">
                Replacement text
                <textarea
                  ref={sourceInput}
                  className="input"
                  rows={4}
                  value={sourceDraft}
                  maxLength={2000}
                  onChange={(event) => setSourceDraft(event.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    const sourceText = selectedSourceText;
                    if (!sourceText) return;
                    const replacement = normalizeSourceReplacement(sourceText.text, sourceDraft);
                    if (!replacement.trim() || /[\r\n]/.test(replacement)) {
                      setError(
                        "Replacement text must be one non-empty line. Choose Delete to remove it.",
                      );
                      return;
                    }
                    setError("");
                    setSourceDraft(replacement);
                    commitSourceTextEdits(
                      replacement === sourceText.text
                        ? sourceTextEdits.filter((edit) => edit.id !== sourceText.id)
                        : upsertSourceEdit(
                            sourceTextEdits,
                            sourceEditFor(sourceText, replacement, false),
                          ),
                    );
                  }}
                >
                  Replace
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1 !text-red-700"
                  onClick={() => {
                    const sourceText = selectedSourceText;
                    if (!sourceText) return;
                    setSourceDraft("");
                    commitSourceTextEdits(
                      upsertSourceEdit(sourceTextEdits, sourceEditFor(sourceText, "", true)),
                    );
                  }}
                >
                  Delete
                </Button>
              </div>
              {sourceEdit && (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    commitSourceTextEdits(
                      sourceTextEdits.filter((edit) => edit.id !== selectedSourceId),
                    );
                    setSourceDraft(sourceReplacementDraft(selectedSourceText?.text ?? ""));
                  }}
                >
                  Undo this text edit
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setSelectedSourceId(undefined);
                  setSourceDraft("");
                }}
              >
                Close text properties
              </Button>
              <p className="property-help">
                The preview temporarily covers the selected text. Your downloaded PDF removes the
                original text before adding the replacement.
              </p>
            </div>
          )}
        </aside>
      </div>
      {signatureOpen && geometry && (
        <SignatureDialog onClose={() => setSignatureOpen(false)} onInsert={insertSignature} />
      )}
    </div>
  );
}

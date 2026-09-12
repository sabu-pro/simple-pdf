"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Matrix, PageGeometry } from "@/types/editor";
import { Busy } from "@/components/ui";

export function PdfPage({
  document,
  pageIndex,
  scale,
  onGeometry,
  onError,
}: {
  document: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  onGeometry: (index: number, geometry: PageGeometry) => void;
  onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    async function render() {
      setRendering(true);
      try {
        const page = await document.getPage(pageIndex + 1);
        if (cancelled || !canvas.current) return;
        const base = page.getViewport({ scale: 1 });
        onGeometry(pageIndex, {
          width: base.width,
          height: base.height,
          transform: base.transform as Matrix,
          rotation: base.rotation,
        });
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const element = canvas.current;
        element.width = Math.ceil(viewport.width * ratio);
        element.height = Math.ceil(viewport.height * ratio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        const context = element.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        task = page.render({
          canvas: element,
          canvasContext: context,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await task.promise;
        if (!cancelled) setRendering(false);
      } catch (error) {
        if (
          !cancelled &&
          !(error instanceof Error && error.name === "RenderingCancelledException")
        ) {
          setRendering(false);
          onError("This page could not be displayed. Try another PDF or a lower zoom level.");
        }
      }
    }
    void render();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, pageIndex, scale, onGeometry, onError]);
  return (
    <>
      <canvas ref={canvas} aria-label={`Original PDF content, page ${pageIndex + 1}`} />
      {rendering && (
        <div className="page-loading">
          <Busy>Rendering page…</Busy>
        </div>
      )}
    </>
  );
}

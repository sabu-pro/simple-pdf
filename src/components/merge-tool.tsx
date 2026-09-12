"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Download, FileText, GripVertical, Trash2, Files } from "lucide-react";
import { Button, Busy, Notice, ToolHeading } from "./ui";
import { UploadZone } from "./upload-zone";
import { CLIENT_MAX_BYTES, errorMessage, formatBytes, validateFile } from "@/lib/files/validation";
import { loadPdf, mergePdfs } from "@/lib/pdf/core";
import { downloadBytes } from "@/lib/files/download";

type MergeFile = { id: string; file: File; bytes: Uint8Array; pages: number };
export function MergeTool() {
  const [files, setFiles] = useState<MergeFile[]>([]),
    [busy, setBusy] = useState<"loading" | "merging" | null>(null);
  const [error, setError] = useState(""),
    [result, setResult] = useState<Uint8Array>();
  const [dragged, setDragged] = useState<string>();
  async function addFiles(selected: File[]) {
    if (busy) return;
    setBusy("loading");
    setError("");
    setResult(undefined);
    try {
      if (files.length + selected.length > 30) throw new Error("Merge up to 30 files at a time.");
      if (
        files.reduce((sum, item) => sum + item.file.size, 0) +
          selected.reduce((sum, file) => sum + file.size, 0) >
        CLIENT_MAX_BYTES * 3
      )
        throw new Error(
          `Keep the combined file size under ${Math.round((CLIENT_MAX_BYTES * 3) / 1024 / 1024)} MB.`,
        );
      const added: MergeFile[] = [];
      for (const file of selected) {
        validateFile(file, "pdf");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdf = await loadPdf(bytes);
        added.push({ id: crypto.randomUUID(), file, bytes, pages: pdf.getPageCount() });
      }
      setFiles([...files, ...added]);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  function move(from: number, to: number) {
    if (busy || from === to || from < 0 || to < 0 || to >= files.length) return;
    const next = [...files];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setFiles(next);
    setResult(undefined);
  }
  async function merge() {
    setBusy("merging");
    setError("");
    setResult(undefined);
    try {
      setResult(await mergePdfs(files.map((file) => file.bytes)));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  const pageCount = files.reduce((count, file) => count + file.pages, 0);
  return (
    <div className="tool-page page-width">
      <ToolHeading
        eyebrow="BETTER TOGETHER"
        title="One PDF. Everything in order."
        description="Bring your PDFs together. Arrange the files just how you want them, then download one complete document."
      />
      <div className="tool-columns">
        <div>
          {!files.length ? (
            <UploadZone
              multiple
              disabled={!!busy}
              onFiles={(selected) => void addFiles(selected)}
            />
          ) : (
            <>
              <div aria-label="PDF merge order">
                {files.map((item, index) => (
                  <div
                    key={item.id}
                    className="file-row"
                    draggable={!busy}
                    onDragStart={() => setDragged(item.id)}
                    onDragEnd={() => setDragged(undefined)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      move(
                        files.findIndex((file) => file.id === dragged),
                        index,
                      );
                      setDragged(undefined);
                    }}
                  >
                    <GripVertical
                      size={18}
                      className="text-muted shrink-0 cursor-grab"
                      aria-hidden="true"
                    />
                    <span className="tool-icon mint !m-0 shrink-0">
                      <FileText size={21} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="file-name text-xs">{item.file.name}</p>
                      <p className="file-meta">
                        {item.pages} {item.pages === 1 ? "page" : "pages"} ·{" "}
                        {formatBytes(item.file.size)}
                      </p>
                    </div>
                    <div className="flex flex-wrap">
                      <button
                        className="icon-btn"
                        aria-label={`Move ${item.file.name} up`}
                        disabled={index === 0 || !!busy}
                        onClick={() => move(index, index - 1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Move ${item.file.name} down`}
                        disabled={index === files.length - 1 || !!busy}
                        onClick={() => move(index, index + 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        className="icon-btn !text-red-700"
                        aria-label={`Remove ${item.file.name}`}
                        disabled={!!busy}
                        onClick={() => {
                          setFiles(files.filter((file) => file.id !== item.id));
                          setResult(undefined);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <UploadZone
                multiple
                compact
                disabled={!!busy}
                onFiles={(selected) => void addFiles(selected)}
              />
              <div className="action-row">
                <span className="text-xs text-muted" role="status">
                  {files.length} files · {pageCount} total pages
                </span>
                <Button disabled={files.length < 2 || !!busy} onClick={() => void merge()}>
                  {busy === "merging" ? (
                    <Busy>Merging PDFs…</Busy>
                  ) : (
                    <>
                      <Files size={17} />
                      Merge PDFs
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
          {busy === "loading" && (
            <div className="my-4">
              <Busy>Reading your PDFs…</Busy>
            </div>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          {result && (
            <div className="panel mt-6">
              <Notice kind="success">All together. Your {pageCount}-page PDF is ready.</Notice>
              <Button onClick={() => downloadBytes(result, "merged.pdf")}>
                <Download size={17} />
                Download merged PDF
              </Button>
            </div>
          )}
        </div>
        <aside className="panel help-panel self-start">
          <h2>Make a little order.</h2>
          <ol>
            <li>Add two or more PDF files.</li>
            <li>Drag files into order, or use the arrow buttons.</li>
            <li>Merge and download your new PDF.</li>
          </ol>
          <p className="mt-6">
            Files are processed in this browser and stay on your device. Up to 30 files and 2,000
            pages per merge.
          </p>
          <p className="mt-4">
            Pages and their visible content are copied. Document-level bookmarks and digital
            signature certificates are not preserved.
          </p>
        </aside>
      </div>
    </div>
  );
}

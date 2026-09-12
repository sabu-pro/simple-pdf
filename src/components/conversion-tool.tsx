"use client";
import { useEffect, useRef, useState } from "react";
import { Download, FileText, RefreshCw, X } from "lucide-react";
import { Button, Busy, Notice, ToolHeading } from "./ui";
import { UploadZone } from "./upload-zone";
import {
  CLIENT_MAX_BYTES,
  errorMessage,
  formatBytes,
  validateFile,
  validateMagic,
} from "@/lib/files/validation";
import { downloadBytes, outputName } from "@/lib/files/download";

type Phase = "idle" | "reading" | "uploading" | "processing" | "success" | "error";
export function ConversionTool({ direction }: { direction: "word-to-pdf" | "pdf-to-word" }) {
  const word = direction === "word-to-pdf";
  const [file, setFile] = useState<File>(),
    [phase, setPhase] = useState<Phase>("idle"),
    [error, setError] = useState("");
  const [progress, setProgress] = useState(0),
    [result, setResult] = useState<Blob>(),
    [warnings, setWarnings] = useState<string[]>([]);
  const [processingStep, setProcessingStep] = useState(0);
  const [capabilities, setCapabilities] = useState<{
      wordToPdf: boolean;
      pdfToWord: boolean;
      maxUploadBytes: number;
      maxPdfToWordBytes?: number;
      maxPdfPages: number;
    }>(),
    [capabilityError, setCapabilityError] = useState(false);
  const request = useRef<XMLHttpRequest | undefined>(undefined);
  const run = useRef(0);
  const active = ["reading", "uploading", "processing"].includes(phase);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/capabilities", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(setCapabilities)
      .catch((error) => {
        if (error.name !== "AbortError") setCapabilityError(true);
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (phase !== "processing" || word) return;
    const converting = window.setTimeout(() => setProcessingStep(1), 1400);
    const preparing = window.setTimeout(() => setProcessingStep(2), 4200);
    return () => {
      window.clearTimeout(converting);
      window.clearTimeout(preparing);
    };
  }, [phase, word]);
  async function choose(files: File[]) {
    setPhase("reading");
    setError("");
    setResult(undefined);
    setWarnings([]);
    try {
      if (files.length !== 1) throw new Error("Convert one file at a time.");
      validateFile(
        files[0],
        word ? "docx" : "pdf",
        word
          ? capabilities?.maxUploadBytes || CLIENT_MAX_BYTES
          : capabilities?.maxPdfToWordBytes || capabilities?.maxUploadBytes || CLIENT_MAX_BYTES,
      );
      validateMagic(
        new Uint8Array(await files[0].slice(0, 16).arrayBuffer()),
        word ? "docx" : "pdf",
      );
      setFile(files[0]);
      setPhase("idle");
    } catch (error) {
      setFile(undefined);
      setError(errorMessage(error));
      setPhase("error");
    }
  }
  async function convertWord() {
    if (!file) return;
    const currentRun = ++run.current;
    setPhase("processing");
    setError("");
    setResult(undefined);
    setWarnings([]);
    try {
      const { convertWordToPdf } = await import("@/lib/conversion/browser-word-to-pdf");
      const converted = await convertWordToPdf(new Uint8Array(await file.arrayBuffer()));
      if (run.current !== currentRun) return;
      const pdfBytes = new Uint8Array(converted.bytes);
      setResult(new Blob([pdfBytes.buffer], { type: "application/pdf" }));
      setWarnings(converted.warnings);
      setPhase("success");
    } catch (error) {
      if (run.current !== currentRun) return;
      setError(
        errorMessage(
          error,
          "This Word document could not be converted. It may be damaged or use unsupported content.",
        ),
      );
      setPhase("error");
    }
  }
  function convert() {
    if (!file) return;
    if (word) {
      void convertWord();
      return;
    }
    setProcessingStep(0);
    setPhase("uploading");
    setProgress(0);
    setError("");
    setResult(undefined);
    setWarnings([]);
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open("POST", "/api/pdf-to-word-worker");
    xhr.responseType = "blob";
    xhr.timeout = 250000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => setPhase("processing");
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setResult(xhr.response);
        setPhase("success");
        try {
          setWarnings(
            JSON.parse(
              decodeURIComponent(xhr.getResponseHeader("X-Conversion-Warnings") || "%5B%5D"),
            ),
          );
        } catch {
          setWarnings([]);
        }
      } else {
        let message = "The server couldn’t convert this document. Please try again.";
        try {
          message = JSON.parse(await (xhr.response as Blob).text()).error || message;
        } catch {
          /* Reverse proxies can return non-JSON errors. */
        }
        setError(message);
        setPhase("error");
      }
      request.current = undefined;
    };
    xhr.onerror = () => {
      setError("Couldn’t reach the conversion server. Check your connection and try again.");
      setPhase("error");
      request.current = undefined;
    };
    xhr.ontimeout = () => {
      setError("Conversion timed out. Try a smaller or simpler document.");
      setPhase("error");
      request.current = undefined;
    };
    xhr.onabort = () => {
      setPhase("idle");
      request.current = undefined;
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  }
  return (
    <div className="tool-page page-width">
      <ToolHeading
        eyebrow={word ? "FROM DRAFT TO READY" : "GIVE YOUR TEXT A FRESH START"}
        title={word ? "Word to PDF. Ready to share." : "Your PDF, in editable Word."}
        description={
          word
            ? "Convert a DOCX document to PDF while preserving its layout and fonts where possible."
            : "Convert a text-based PDF to an editable DOCX while preserving its layout, tables, columns, images and text formatting where possible."
        }
      />
      <div className="tool-columns">
        <div>
          {!word && capabilities && !capabilities.pdfToWord && (
            <Notice>
              PDF to Word needs the free pdf2docx Python package on this server. Install the
              conversion requirements and restart SimplePDF.
            </Notice>
          )}
          {capabilityError && (
            <Notice>
              Couldn’t load the conversion settings. You can still try converting your document.
            </Notice>
          )}
          {!file ? (
            <UploadZone
              kind={word ? "docx" : "pdf"}
              local={false}
              privacyMessage={
                word ? "Your DOCX stays in this browser while it is converted." : undefined
              }
              maxBytes={
                word
                  ? capabilities?.maxUploadBytes
                  : capabilities?.maxPdfToWordBytes || capabilities?.maxUploadBytes
              }
              disabled={active}
              onFiles={(files) => void choose(files)}
            />
          ) : (
            <div className="panel">
              <div className="file-row !border-0 !p-0 !mb-6">
                <span className={`tool-icon ${word ? "peach" : "lavender"} !m-0 shrink-0`}>
                  <FileText size={22} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="file-name text-sm">{file.name}</p>
                  <p className="file-meta">{formatBytes(file.size)}</p>
                </div>
                <button
                  className="icon-btn"
                  aria-label="Remove selected file"
                  disabled={active}
                  onClick={() => {
                    setFile(undefined);
                    setResult(undefined);
                    setPhase("idle");
                    setError("");
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-muted leading-6">
                {word
                  ? "Your DOCX is converted in your browser and is not uploaded. Review the PDF for layout changes."
                  : "Your file is uploaded temporarily for conversion and deleted when processing finishes. Layout and formatting are preserved where the PDF structure allows."}
              </p>
              <div className="action-row">
                <Button
                  onClick={convert}
                  disabled={
                    active ||
                    (word && capabilities?.wordToPdf === false) ||
                    (!word && capabilities?.pdfToWord === false)
                  }
                >
                  {phase === "uploading" ? (
                    <Busy>Uploading… {progress}%</Busy>
                  ) : phase === "processing" ? (
                    <Busy>
                      {word
                        ? "Converting document…"
                        : [
                            "Analysing PDF layout…",
                            "Converting to Word…",
                            "Preparing your document…",
                          ][processingStep]}
                    </Busy>
                  ) : (
                    <>
                      <RefreshCw size={16} />
                      Convert to {word ? "PDF" : "Word"}
                    </>
                  )}
                </Button>
                {active && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      run.current++;
                      request.current?.abort();
                      setPhase("idle");
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
          {phase === "reading" && <Busy>Checking your file…</Busy>}
          {error && <Notice kind="error">{error}</Notice>}
          {result && file && (
            <div className="panel mt-6">
              <Notice kind="success">Done! Your {word ? "PDF" : "Word document"} is ready.</Notice>
              {warnings.map((warning) => (
                <p key={warning} className="text-xs text-muted leading-6 mb-4">
                  {warning}
                </p>
              ))}
              <Button
                onClick={() =>
                  downloadBytes(result, outputName(file.name, "", word ? "pdf" : "docx"))
                }
              >
                <Download size={16} />
                Download {word ? "PDF" : "Word document"}
              </Button>
            </div>
          )}
        </div>
        <aside className="panel help-panel self-start">
          <h2>What to expect</h2>
          {word ? (
            <>
              <ol>
                <li>Choose a DOCX Word document.</li>
                <li>Convert it to PDF.</li>
                <li>Download and review your PDF.</li>
              </ol>
              <p className="mt-6">
                Complex layouts and missing fonts can change the result. Legacy .doc files aren’t
                supported in this version.
              </p>
            </>
          ) : (
            <>
              <p>
                Text-based PDFs work best. The converter uses the page layout to recreate editable
                text, tables, columns, images, formatting, spacing and page breaks where possible.
              </p>
              <p className="mt-4">
                Scanned or image-only PDFs need OCR, which isn’t included. SimplePDF will let you
                know when a file has no text layer.
              </p>
              <p className="mt-4">
                PDF and Word store document structure differently, so dense forms and unusual fonts
                may still need small adjustments. Review the result before sharing.
              </p>
              <p className="mt-4">Up to {capabilities?.maxPdfPages || 300} pages per conversion.</p>
            </>
          )}
          <p className="mt-6">
            {word
              ? "Conversion runs in your browser, so the DOCX is not uploaded."
              : "No permanent document storage. Temporary job files are deleted when processing finishes or fails."}
          </p>
        </aside>
      </div>
    </div>
  );
}

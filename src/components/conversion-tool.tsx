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
      maxPdfPages: number;
    }>(),
    [capabilityError, setCapabilityError] = useState(false);
  const request = useRef<XMLHttpRequest | undefined>(undefined);
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
        capabilities?.maxUploadBytes || CLIENT_MAX_BYTES,
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
  function convert() {
    if (!file) return;
    setProcessingStep(0);
    setPhase("uploading");
    setProgress(0);
    setError("");
    setResult(undefined);
    setWarnings([]);
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open("POST", `/api/convert/${direction}`);
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
            ? "Convert a DOCX document into a PDF using the free LibreOffice engine on this server."
            : "Convert a text-based PDF into an editable DOCX while retaining its layout, tables, columns, images and text styling as closely as possible."
        }
      />
      <div className="tool-columns">
        <div>
          {word && capabilities && !capabilities.wordToPdf && (
            <Notice>
              Word to PDF needs LibreOffice on this server. Install the free LibreOffice application
              and restart SimplePDF. Setup steps are in README.md.
            </Notice>
          )}
          {!word && capabilities && !capabilities.pdfToWord && (
            <Notice>
              PDF to Word needs the free pdf2docx Python package on this server. Install the
              conversion requirements and restart SimplePDF.
            </Notice>
          )}
          {capabilityError && (
            <Notice>
              Couldn’t check the server’s conversion tools. You can try a conversion; any missing
              dependency will be reported.
            </Notice>
          )}
          {!file ? (
            <UploadZone
              kind={word ? "docx" : "pdf"}
              local={false}
              maxBytes={capabilities?.maxUploadBytes}
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
                  ? "Your file will be uploaded temporarily to this server for conversion. Review the resulting PDF for any layout changes."
                  : "Your file is uploaded temporarily for conversion and deleted when the job finishes. Text, tables, columns, images, fonts, spacing and page boundaries are retained where the PDF structure allows."}
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
                  <Button variant="ghost" onClick={() => request.current?.abort()}>
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
          <h2>{word ? "A reliable first impression." : "What to expect"}</h2>
          {word ? (
            <>
              <ol>
                <li>Choose a DOCX Word document.</li>
                <li>Convert it with LibreOffice.</li>
                <li>Download and check your PDF.</li>
              </ol>
              <p className="mt-6">
                Complex layouts and missing fonts can change the result. Legacy .doc files aren’t
                supported in this version.
              </p>
            </>
          ) : (
            <>
              <p>
                Text-based PDFs work best. The converter analyses page geometry and recreates
                editable text, tables, columns, images, type styling, alignment, spacing and page
                boundaries where practical.
              </p>
              <p className="mt-4">
                Scanned or image-only PDFs need OCR. This version detects pages without a text layer
                and explains when OCR may be required.
              </p>
              <p className="mt-4">
                PDF and Word store document structure differently, so dense forms and unusual fonts
                may still need small adjustments. Review the result before sharing.
              </p>
              <p className="mt-4">Up to {capabilities?.maxPdfPages || 300} pages per conversion.</p>
            </>
          )}
          <p className="mt-6">
            No permanent document storage. Temporary job files are deleted when processing finishes
            or fails.
          </p>
        </aside>
      </div>
    </div>
  );
}

"use client";
import { useRef, useState } from "react";
import { FileUp, ShieldCheck } from "lucide-react";
import { Button } from "./ui";
import { CLIENT_MAX_BYTES } from "@/lib/files/validation";

export function UploadZone({
  onFiles,
  kind = "pdf",
  multiple = false,
  disabled = false,
  compact = false,
  local = true,
  maxBytes = CLIENT_MAX_BYTES,
}: {
  onFiles: (files: File[]) => void;
  kind?: "pdf" | "docx";
  multiple?: boolean;
  disabled?: boolean;
  compact?: boolean;
  local?: boolean;
  maxBytes?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div>
      <div
        className={`upload-zone ${dragging ? "dragging" : ""} ${compact ? "!py-7" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) onFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {!compact && (
          <>
            <span className="upload-icon">
              <FileUp size={26} />
            </span>
            <h2>
              Drop your {kind === "pdf" ? "PDF" : "Word document"}
              {multiple ? "s" : ""} here
            </h2>
            <p>Or choose {multiple ? "files" : "a file"} from your device to get started.</p>
          </>
        )}
        <input
          className="sr-only"
          ref={input}
          type="file"
          accept={
            kind === "pdf"
              ? ".pdf,application/pdf"
              : ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          }
          multiple={multiple}
          disabled={disabled}
          aria-label={`Choose ${kind.toUpperCase()} ${multiple ? "files" : "file"}`}
          onChange={(event) => {
            if (event.target.files?.length) onFiles(Array.from(event.target.files));
            event.target.value = "";
          }}
        />
        <Button disabled={disabled} onClick={() => input.current?.click()}>
          <FileUp size={17} />
          {compact
            ? "Add more PDFs"
            : `Choose ${kind === "pdf" ? "PDF" : "Word"} ${multiple ? "files" : "file"}`}
        </Button>
        <small>
          {kind === "pdf" ? "PDF" : "DOCX"} files · Up to {Math.round(maxBytes / 1024 / 1024)} MB{" "}
          {multiple ? "each" : ""}
        </small>
      </div>
      {!compact && (
        <p className="privacy-note">
          <ShieldCheck size={16} className="shrink-0 mt-0.5" />
          {local
            ? "Processed in your browser. Your files stay on your device."
            : "Conversion files are processed temporarily on this server and deleted after processing."}
        </p>
      )}
    </div>
  );
}

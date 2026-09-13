"use client";
import { useEffect, useRef, useState } from "react";
import { Eraser, X, PenLine, Type, ImagePlus } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage, UserFacingError, validateFile, validateMagic } from "@/lib/files/validation";
import { readBlobBytes } from "@/lib/files/browser-file";

function trimCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d")!;
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = width,
    top = height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (left > right) throw new UserFacingError("Add your signature first.");
  const output = document.createElement("canvas");
  output.width = right - left + 17;
  output.height = bottom - top + 17;
  output
    .getContext("2d")!
    .drawImage(
      canvas,
      left,
      top,
      right - left + 1,
      bottom - top + 1,
      8,
      8,
      right - left + 1,
      bottom - top + 1,
    );
  return { dataUrl: output.toDataURL("image/png"), ratio: output.width / output.height };
}

export function SignatureDialog({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (dataUrl: string, ratio: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [name, setName] = useState("");
  const [font, setFont] = useState("Caveat");
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<{ dataUrl: string; ratio: number }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * 800) / rect.width,
      y: ((event.clientY - rect.top) * 260) / rect.height,
    };
  }
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      validateFile(file, "image", 5 * 1024 * 1024);
      validateMagic(await readBlobBytes(file), "image");
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 20_000_000)
          throw new UserFacingError("Use a signature image smaller than 20 megapixels.");
        const output = document.createElement("canvas"),
          factor = Math.min(1, 1600 / bitmap.width, 800 / bitmap.height);
        output.width = Math.round(bitmap.width * factor);
        output.height = Math.round(bitmap.height * factor);
        output.getContext("2d")!.drawImage(bitmap, 0, 0, output.width, output.height);
        setUploaded(trimCanvas(output));
      } finally {
        bitmap.close();
      }
    } catch (error) {
      setError(errorMessage(error, "Something went wrong loading this image — please try again."));
    } finally {
      setBusy(false);
    }
  }
  async function insert() {
    setError("");
    setBusy(true);
    try {
      let result: { dataUrl: string; ratio: number };
      if (tab === "draw") result = trimCanvas(canvas.current!);
      else if (tab === "upload") {
        if (!uploaded) throw new UserFacingError("Choose a signature image first.");
        result = uploaded;
      } else {
        if (!name.trim()) throw new UserFacingError("Type your name first.");
        await document.fonts.load(`64px "${font}"`);
        const output = document.createElement("canvas");
        output.width = 1400;
        output.height = 180;
        const context = output.getContext("2d")!;
        context.font = `64px "${font}", cursive`;
        context.fillStyle = "#202d2b";
        context.fillText(name.trim(), 20, 112, 1360);
        result = trimCanvas(output);
      }
      onInsert(result.dataUrl, result.ratio);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="signature-dialog"
      aria-labelledby="signature-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="eyebrow">MAKE IT YOURS</div>
            <h2 id="signature-title">Add your signature</h2>
          </div>
          <button className="icon-btn" aria-label="Close signature dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p className="text-muted text-xs mt-3 mb-5">
          Create a signature, then move and resize it on your page.
        </p>
        <div className="signature-tabs" role="tablist" aria-label="Signature method">
          {(
            [
              { id: "draw", label: "Draw", icon: PenLine },
              { id: "type", label: "Type", icon: Type },
              { id: "upload", label: "Upload", icon: ImagePlus },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`signature-${item.id}`}
              onClick={() => {
                setTab(item.id);
                setError("");
              }}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </div>
        <div id="signature-draw" role="tabpanel" hidden={tab !== "draw"}>
          <canvas
            ref={canvas}
            width={800}
            height={260}
            className="signature-canvas"
            aria-label="Draw your signature here, or use the Type tab for keyboard input"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = true;
              const p = point(event),
                context = event.currentTarget.getContext("2d")!;
              context.beginPath();
              context.moveTo(p.x, p.y);
              context.lineWidth = 3;
              context.lineCap = "round";
              context.lineJoin = "round";
              context.strokeStyle = "#202d2b";
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return;
              const p = point(event),
                context = event.currentTarget.getContext("2d")!;
              context.lineTo(p.x, p.y);
              context.stroke();
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
            onPointerCancel={() => {
              drawing.current = false;
            }}
          />
          <Button
            variant="ghost"
            onClick={() => canvas.current?.getContext("2d")?.clearRect(0, 0, 800, 260)}
          >
            <Eraser size={14} />
            Clear drawing
          </Button>
        </div>
        <div id="signature-type" role="tabpanel" hidden={tab !== "type"} className="space-y-4">
          <label className="field">
            Your name
            <input
              className="input"
              maxLength={70}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Alex Morgan"
            />
          </label>
          <label className="field">
            Signature style
            <select
              className="input"
              value={font}
              onChange={(event) => setFont(event.target.value)}
            >
              <option value="Caveat">Handwritten</option>
              <option value="Segoe Script">Classic script</option>
              <option value="Brush Script MT">Brush script</option>
            </select>
          </label>
          <div className="typed-preview" style={{ fontFamily: `"${font}", cursive` }}>
            {name || "Your signature"}
          </div>
        </div>
        <div id="signature-upload" role="tabpanel" hidden={tab !== "upload"}>
          <label className="field">
            Signature image (PNG or JPG, up to 5 MB)
            <input
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              className="input"
              disabled={busy}
              onChange={(event) => void upload(event.target.files?.[0])}
            />
          </label>
          <p className="text-xs text-muted my-3">
            A transparent PNG gives the cleanest result. Existing image backgrounds are preserved.
          </p>
          {uploaded && (
            <div className="uploaded-signature">
              <svg
                viewBox={`0 0 ${uploaded.ratio * 100} 100`}
                role="img"
                aria-label="Uploaded signature preview"
              >
                <image href={uploaded.dataUrl} width={uploaded.ratio * 100} height={100} />
              </svg>
            </div>
          )}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="action-row">
          <span className="text-xs text-muted">
            This creates a visual signature, not a digital certificate.
          </span>
          <Button onClick={() => void insert()} disabled={busy}>
            Place signature
          </Button>
        </div>
      </div>
    </dialog>
  );
}

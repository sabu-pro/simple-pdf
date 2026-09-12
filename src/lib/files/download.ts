export function downloadBytes(data: Uint8Array | Blob, filename: string, type = "application/pdf") {
  const blob = data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function outputName(input: string, suffix: string, extension = "pdf") {
  return `${
    input
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N} ._-]/gu, "_")
      .slice(0, 100) || "document"
  }${suffix}.${extension}`;
}

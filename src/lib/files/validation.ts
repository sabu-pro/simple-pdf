const configuredMb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB);
export const CLIENT_MAX_BYTES =
  (Number.isFinite(configuredMb) && configuredMb >= 1 && configuredMb <= 100 ? configuredMb : 50) *
  1024 *
  1024;
export type FileKind = "pdf" | "docx" | "image";
export type FileInfo = { name: string; size: number; type: string };
const allowed = {
  pdf: { extensions: ["pdf"], mime: ["application/pdf"] },
  docx: {
    extensions: ["docx"],
    mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  image: { extensions: ["png", "jpg", "jpeg"], mime: ["image/png", "image/jpeg"] },
};

export function validateFile(file: FileInfo, kind: FileKind, maxBytes = CLIENT_MAX_BYTES) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowed[kind].extensions.includes(extension))
    throw new Error(
      `Choose ${kind === "image" ? "a PNG or JPG image" : `a ${kind.toUpperCase()} file`}.`,
    );
  if (
    file.type &&
    file.type !== "application/octet-stream" &&
    !allowed[kind].mime.includes(file.type.toLowerCase())
  )
    throw new Error("The file type does not match its extension.");
  if (!file.size) throw new Error("This file is empty. Please choose another file.");
  if (file.size > maxBytes)
    throw new Error(`Choose a file smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
}

export function validateMagic(bytes: Uint8Array, kind: FileKind) {
  const pdf = bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!(kind === "pdf" ? pdf : kind === "docx" ? zip : png || jpg))
    throw new Error("The file contents do not match the expected file type.");
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  return error instanceof Error ? error.message : fallback;
}

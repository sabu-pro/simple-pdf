const messages: Record<string, string> = {
  OCR_REQUIRED: "This PDF appears to be scanned or image-based. Text conversion requires OCR.",
  FILE_TOO_LARGE: "This upload is too large. Please choose a smaller PDF.",
  OUTPUT_TOO_LARGE: "The converted document is too large. Try a smaller PDF.",
  INVALID_FILE: "Choose a valid PDF file. It may be damaged or password protected.",
  EMPTY_FILE: "This file is empty. Please choose another file.",
  MISSING_FILE: "Choose a PDF to convert.",
  INVALID_UPLOAD: "This upload could not be read. Please choose the file again.",
  UPLOAD_TIMEOUT: "The upload timed out. Please try again.",
  PDF_TO_WORD_ENGINE_UNAVAILABLE: "PDF to Word is temporarily unavailable. Please try again later.",
  PYTHON_DEPENDENCIES: "PDF to Word is temporarily unavailable. Please try again later.",
};

export function conversionResponseMessage(body: unknown) {
  // Server/proxy exception strings are not user-facing messages.
  const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
  if (typeof code === "string" && Object.hasOwn(messages, code)) return messages[code];
  return "The server couldn’t convert this document. Please try again.";
}

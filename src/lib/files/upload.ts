import Busboy from "busboy";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ConversionError } from "@/lib/conversion/errors";
import { validateFile, validateMagic } from "./validation";

export async function receiveUpload(
  request: Request,
  directory: string,
  kind: "pdf" | "docx",
  maxBytes: number,
) {
  if (!request.body) throw new ConversionError("Choose a file to convert.", "MISSING_FILE", 400);
  const length = Number(request.headers.get("content-length"));
  const requestLimit = maxBytes + 64 * 1024;
  if (length > requestLimit)
    throw new ConversionError("This upload is too large.", "FILE_TOO_LARGE", 413);
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: { "content-type": request.headers.get("content-type") || "" },
      limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 2, headerPairs: 50 },
    });
  } catch {
    throw new ConversionError("Send one file as a multipart upload.", "INVALID_UPLOAD", 400);
  }
  const target = path.join(directory, `input.${kind}`);
  let failure: Error | undefined,
    received = false,
    fileWork: Promise<void> | undefined,
    bytes = 0;
  const source = Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>);
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(
        bytes > requestLimit
          ? new ConversionError("This upload is too large.", "FILE_TOO_LARGE", 413)
          : null,
        chunk,
      );
    },
  });
  parser.on("file", (field, file, info) => {
    received = true;
    try {
      if (field !== "file") throw new Error("Choose a file to convert.");
      validateFile({ name: info.filename, type: info.mimeType, size: 1 }, kind, maxBytes);
    } catch (error) {
      failure = error as Error;
      file.resume();
      return;
    }
    file.on("limit", () => {
      failure = new ConversionError("This upload is too large.", "FILE_TOO_LARGE", 413);
    });
    fileWork = pipeline(file, createWriteStream(target, { flags: "wx", mode: 0o600 })).catch(
      (error) => {
        failure = error;
      },
    );
  });
  parser.on("filesLimit", () => {
    failure = new Error("Convert one file at a time.");
  });
  parser.on("fieldsLimit", () => {
    failure = new Error("Unexpected upload fields.");
  });
  // Busboy emits partsLimit on reaching the limit. Permit one part and reject the second.
  parser.on("partsLimit", () => {
    failure = new Error("Send only one file per conversion.");
  });
  const timer = setTimeout(
    () =>
      source.destroy(
        new ConversionError("The upload timed out. Please try again.", "UPLOAD_TIMEOUT", 408),
      ),
    60000,
  );
  try {
    await pipeline(source, limiter, parser, { signal: request.signal });
    await fileWork;
  } catch (error) {
    await fileWork;
    throw error instanceof ConversionError
      ? error
      : new ConversionError(
          "The upload was interrupted or malformed. Please try again.",
          "INVALID_UPLOAD",
          400,
        );
  } finally {
    clearTimeout(timer);
  }
  if (failure)
    throw failure instanceof ConversionError
      ? failure
      : new ConversionError(failure.message, "INVALID_FILE", 400);
  if (!received || !fileWork)
    throw new ConversionError("Choose a file to convert.", "MISSING_FILE", 400);
  const size = (await stat(target)).size;
  if (!size) throw new ConversionError("This file is empty.", "EMPTY_FILE", 400);
  const buffer = await readFile(target);
  try {
    validateMagic(buffer, kind);
  } catch {
    throw new ConversionError(
      "The file contents do not match the expected file type.",
      "INVALID_FILE",
      400,
    );
  }
  return target;
}

/** Stream one PDF plus a small JSON edit manifest without buffering the PDF in memory. */
export async function receiveTextEditUpload(request: Request, directory: string, maxBytes: number) {
  if (!request.body) throw new ConversionError("Choose a PDF to edit.", "MISSING_FILE", 400);
  const manifestLimit = 512 * 1024;
  const requestLimit = maxBytes + manifestLimit + 64 * 1024;
  const length = Number(request.headers.get("content-length"));
  if (length > requestLimit)
    throw new ConversionError("This upload is too large.", "FILE_TOO_LARGE", 413);
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: { "content-type": request.headers.get("content-type") || "" },
      limits: {
        fileSize: maxBytes,
        files: 1,
        fields: 1,
        fieldSize: manifestLimit,
        parts: 3,
        headerPairs: 50,
      },
    });
  } catch {
    throw new ConversionError(
      "Send one PDF and its edits as a multipart upload.",
      "INVALID_UPLOAD",
      400,
    );
  }
  const target = path.join(directory, "input.pdf");
  let failure: Error | undefined;
  let received = false;
  let edits: string | undefined;
  let fileWork: Promise<void> | undefined;
  let bytes = 0;
  const source = Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>);
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(
        bytes > requestLimit
          ? new ConversionError("This upload is too large.", "FILE_TOO_LARGE", 413)
          : null,
        chunk,
      );
    },
  });
  parser.on("file", (field, file, info) => {
    received = true;
    try {
      if (field !== "file") throw new Error("Choose one PDF to edit.");
      validateFile({ name: info.filename, type: info.mimeType, size: 1 }, "pdf", maxBytes);
    } catch (error) {
      failure = error as Error;
      file.resume();
      return;
    }
    file.on("limit", () => {
      failure = new ConversionError("This upload is too large.", "FILE_TOO_LARGE", 413);
    });
    fileWork = pipeline(file, createWriteStream(target, { flags: "wx", mode: 0o600 })).catch(
      (error) => {
        failure = error;
      },
    );
  });
  parser.on("field", (field, value, info) => {
    if (field !== "edits" || edits !== undefined || info.valueTruncated) {
      failure = new Error("The text edit manifest is invalid or too large.");
      return;
    }
    edits = value;
  });
  parser.on("filesLimit", () => {
    failure = new Error("Edit one PDF at a time.");
  });
  parser.on("fieldsLimit", () => {
    failure = new Error("Send one text edit manifest.");
  });
  parser.on("partsLimit", () => {
    failure = new Error("Send only one PDF and one text edit manifest.");
  });
  const timer = setTimeout(
    () =>
      source.destroy(
        new ConversionError("The upload timed out. Please try again.", "UPLOAD_TIMEOUT", 408),
      ),
    60000,
  );
  try {
    await pipeline(source, limiter, parser, { signal: request.signal });
    await fileWork;
  } catch (error) {
    await fileWork;
    throw error instanceof ConversionError
      ? error
      : new ConversionError(
          "The upload was interrupted or malformed. Please try again.",
          "INVALID_UPLOAD",
          400,
        );
  } finally {
    clearTimeout(timer);
  }
  if (failure)
    throw failure instanceof ConversionError
      ? failure
      : new ConversionError(failure.message, "INVALID_FILE", 400);
  if (!received || !fileWork)
    throw new ConversionError("Choose a PDF to edit.", "MISSING_FILE", 400);
  if (!edits)
    throw new ConversionError("No source text edits were provided.", "MISSING_EDITS", 400);
  const size = (await stat(target)).size;
  if (!size) throw new ConversionError("This file is empty.", "EMPTY_FILE", 400);
  const buffer = await readFile(target);
  try {
    validateMagic(buffer, "pdf");
  } catch {
    throw new ConversionError("The file is not a valid PDF.", "INVALID_FILE", 400);
  }
  return { input: target, edits };
}

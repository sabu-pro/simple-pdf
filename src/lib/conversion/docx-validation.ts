import yauzl from "yauzl";
import { ConversionError } from "./errors";

/** Inspect the ZIP central directory and bounded XML streams without extracting user paths. */
export async function validateDocx(filename: string) {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip)
        return reject(
          new ConversionError(
            "This DOCX file is damaged or is not a valid Word document.",
            "INVALID_DOCX",
          ),
        );
      let total = 0,
        entries = 0,
        documentFound = false,
        typesFound = false,
        settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(new ConversionError(message, "INVALID_DOCX"));
      };
      zip.on("error", () => fail("This Word document could not be read."));
      zip.on("entry", (entry) => {
        if (settled) return;
        const name = entry.fileName;
        entries++;
        total += entry.uncompressedSize;
        if (
          entries > 5000 ||
          total > 200 * 1024 * 1024 ||
          entry.uncompressedSize > 40 * 1024 * 1024 ||
          entry.uncompressedSize > Math.max(1, entry.compressedSize) * 1000
        )
          return fail("This document expands beyond the safe conversion limit.");
        if (entry.generalPurposeBitFlag & 1)
          return fail("Password-protected Word documents are not supported yet.");
        if (
          name.includes("..") ||
          name.startsWith("/") ||
          name.includes("\\") ||
          /(^|\/)(vbaProject\.bin|embeddings)(\/|$)/i.test(name)
        )
          return fail("Documents with embedded programs or unsafe paths are not supported.");
        if (name === "word/document.xml") documentFound = true;
        if (name === "[Content_Types].xml") typesFound = true;
        if (!name.endsWith(".xml") && !name.endsWith(".rels")) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail("This Word document contains damaged data.");
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size > 40 * 1024 * 1024) {
              stream.destroy();
              fail("This document contains too much XML data.");
            } else chunks.push(chunk);
          });
          stream.on("error", () => fail("This Word document contains damaged XML."));
          stream.on("end", () => {
            const xml = Buffer.concat(chunks).toString("utf8");
            if (/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|oleObject|altChunk/i.test(xml))
              return fail(
                "Documents containing macros, embedded content or XML entities are not supported.",
              );
            if (name.endsWith(".rels") && /TargetMode\s*=\s*["']External["']/i.test(xml)) {
              // Ordinary hyperlinks are harmless; linked images/templates can trigger network access in office engines.
              const relationships = xml.match(/<Relationship\b[^>]*>/gi) || [];
              if (
                relationships.some(
                  (rel) =>
                    /TargetMode\s*=\s*["']External["']/i.test(rel) &&
                    !/Type\s*=\s*["'][^"']*\/hyperlink["']/i.test(rel),
                )
              )
                return fail(
                  "Remove externally linked images or templates before converting this document.",
                );
            }
            if (
              name === "[Content_Types].xml" &&
              !xml.includes(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
              )
            )
              return fail("Choose a standard DOCX Word document.");
            if (!settled) zip.readEntry();
          });
        });
      });
      zip.on("end", () => {
        if (!settled) {
          settled = true;
          if (!documentFound || !typesFound)
            reject(
              new ConversionError(
                "The file is a ZIP archive, but not a Word document.",
                "INVALID_DOCX",
              ),
            );
          else resolve();
        }
      });
      zip.readEntry();
    });
  });
}

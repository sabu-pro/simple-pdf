import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, degrees } from "pdf-lib";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import yauzl from "yauzl";
import { withTempDirectory } from "@/lib/files/temp";
import { receiveUpload } from "@/lib/files/upload";
import { validateDocx } from "@/lib/conversion/docx-validation";
import { LocalDocumentConversionService } from "@/lib/conversion/service";
import { runProcess } from "@/lib/conversion/process";
import { conversionConfig } from "@/lib/conversion/config";
import { isSameOrigin } from "@/lib/files/origin";
import { buildTextLayerModel } from "@/lib/pdf/text-layer";
import { convertWordToPdf } from "@/lib/conversion/browser-word-to-pdf";

function docx() {
  return Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph("A real Word document.")] }] }),
  );
}
async function pdf(text?: string) {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  if (text) page.drawText(text, { x: 50, y: 700, size: 18 });
  return document.save();
}
async function wordXml(buffer: Buffer) {
  return new Promise<string>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      zip.on("entry", (entry) => {
        if (entry.fileName !== "word/document.xml") return zip.readEntry();
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => {
            zip.close();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
          stream.on("error", reject);
        });
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
async function zipEntryNames(buffer: Buffer) {
  return new Promise<string[]>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const names: string[] = [];
      zip.on("entry", (entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolve(names));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("upload origin", () => {
  it("uses the incoming Host when Next normalizes its internal URL", () => {
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).toBe(true);
  });
  it("rejects other sites and malformed origins", () => {
    for (const origin of ["https://other.example", "null", "https://localhost:3000"])
      expect(
        isSameOrigin(
          new Request("http://localhost:3000/api", { headers: { host: "localhost:3000", origin } }),
        ),
      ).toBe(false);
  });
});

describe("temporary file lifecycle", () => {
  it("deletes private job files on success and failure", async () => {
    let captured = "";
    await withTempDirectory(async (directory) => {
      captured = directory;
      await writeFile(path.join(directory, "private.txt"), "private");
    });
    await expect(access(captured)).rejects.toThrow();
    await expect(
      withTempDirectory(async (directory) => {
        captured = directory;
        await writeFile(path.join(directory, "private.txt"), "private");
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    await expect(access(captured)).rejects.toThrow();
  });
});
describe("bounded multipart uploads", () => {
  it("accepts a PDF and never uses the supplied filename as a filesystem path", async () => {
    await withTempDirectory(async (directory) => {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(await pdf("Upload test"))], { type: "application/pdf" }),
        "../../private.pdf",
      );
      const filename = await receiveUpload(
        new Request("http://localhost/api", { method: "POST", body: form }),
        directory,
        "pdf",
        50000,
      );
      expect(filename).toBe(path.join(directory, "input.pdf"));
      expect((await readFile(filename)).subarray(0, 5).toString()).toBe("%PDF-");
    });
  });
  it("rejects disguised content, extra files, and streaming size overflow", async () => {
    for (const variant of ["fake", "extra", "large"] as const)
      await withTempDirectory(async (directory) => {
        const form = new FormData();
        form.append(
          "file",
          new Blob([variant === "fake" ? "malicious" : new Uint8Array(await pdf("Valid"))], {
            type: "application/pdf",
          }),
          "report.pdf",
        );
        if (variant === "extra")
          form.append("file", new Blob(["%PDF-extra"], { type: "application/pdf" }), "extra.pdf");
        await expect(
          receiveUpload(
            new Request("http://localhost/api", { method: "POST", body: form }),
            directory,
            "pdf",
            variant === "large" ? 100 : 50000,
          ),
        ).rejects.toThrow();
      });
  });
});
describe("document conversion", () => {
  const service = new LocalDocumentConversionService();
  it("validates actual DOCX structure", async () => {
    await withTempDirectory(async (directory) => {
      const filename = path.join(directory, "input.docx");
      await writeFile(filename, await docx());
      await expect(validateDocx(filename)).resolves.toBeUndefined();
      await writeFile(filename, "PK not a docx");
      await expect(validateDocx(filename)).rejects.toThrow("damaged");
    });
  });
  it("converts a styled Word document with tables, images, headers, footers, and page breaks in JavaScript", async () => {
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const source = await Packer.toBuffer(
      new Document({
        sections: [
          {
            headers: {
              default: new Header({ children: [new Paragraph("Quarterly Timesheet")] }),
            },
            footers: {
              default: new Footer({ children: [new Paragraph("Internal review copy")] }),
            },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 240 },
                children: [
                  new TextRun({ text: "Alex Morgan", bold: true, size: 32, font: "Calibri" }),
                  new TextRun({ text: " — September", italics: true, size: 24, font: "Cambria" }),
                ],
              }),
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph("Project")] }),
                      new TableCell({ children: [new Paragraph("Hours")] }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph("Quarterly reporting")] }),
                      new TableCell({ children: [new Paragraph("7.5")] }),
                    ],
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new ImageRun({
                    type: "png",
                    data: pixel,
                    transformation: { width: 12, height: 12 },
                  }),
                ],
              }),
              new Paragraph({ children: [new PageBreak()] }),
              new Paragraph({ children: [new TextRun({ text: "Second page", bold: true })] }),
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.startsWith("/ream-fonts/")) throw new Error(`Unexpected font URL: ${url}`);
      const font = await readFile(path.resolve("public", url.slice(1)));
      return new Response(font);
    });
    const converted = await convertWordToPdf(new Uint8Array(source));
    const output = await PDFDocument.load(converted.bytes);
    expect(output.getPageCount()).toBeGreaterThanOrEqual(2);
    const text = Object.values((await buildTextLayerModel(converted.bytes)).pages)
      .flatMap((page) => page.blocks)
      .map((block) => block.text)
      .join(" ");
    expect(text).toContain("Alex Morgan");
    expect(text).toContain("Quarterly reporting");
    expect(text).toContain("Second page");
    expect(converted.warnings.join(" ")).toContain("metric-compatible fonts");
  }, 30000);
  it("reports missing LibreOffice without producing a fake PDF", async () => {
    vi.stubEnv("LIBREOFFICE_PATH", path.resolve(".local/definitely-not-installed.exe"));
    await withTempDirectory(async (directory) => {
      const filename = path.join(directory, "input.docx");
      await writeFile(filename, await docx());
      await expect(service.convert("word-to-pdf", filename, directory)).rejects.toMatchObject({
        code: "LIBREOFFICE_UNAVAILABLE",
        status: 503,
      });
    });
  });
  it("extracts text and writes a real editable DOCX in an isolated process", async () => {
    await withTempDirectory(async (directory) => {
      const filename = path.join(directory, "input.pdf");
      await writeFile(filename, await pdf("An editable sentence from the PDF."));
      const result = await service.convert("pdf-to-word", filename, directory);
      expect(result.mime).toContain("wordprocessingml");
      expect(await wordXml(Buffer.from(result.bytes))).toContain(
        "An editable sentence from the PDF.",
      );
      await validateDocx(path.join(directory, "converted.docx"));
    });
  });
  it("reports OCR requirements for image-only or empty pages", async () => {
    await withTempDirectory(async (directory) => {
      const filename = path.join(directory, "input.pdf");
      await writeFile(filename, await pdf());
      await expect(service.convert("pdf-to-word", filename, directory)).rejects.toMatchObject({
        code: "OCR_REQUIRED",
      });
    });
  });
  it("marks missing text in mixed documents and returns a warning", async () => {
    await withTempDirectory(async (directory) => {
      const document = await PDFDocument.load(await pdf("Visible text"));
      document.addPage([612, 792]);
      const filename = path.join(directory, "input.pdf");
      await writeFile(filename, await document.save());
      const result = await service.convert("pdf-to-word", filename, directory);
      expect(result.warnings.join(" ")).toContain("1 page(s)");
      expect(await wordXml(Buffer.from(result.bytes))).toContain("Visible text");
    });
  });
  it("preserves complex timesheet and form structure in editable Word files", async () => {
    for (const fixture of [
      {
        name: "complex-timesheet.pdf",
        text: ["Alex Morgan", "Quarterly reporting", "Variance analysis", "Page 2"],
        sections: 2,
      },
      {
        name: "complex-form.pdf",
        text: ["Alex Morgan", "SP-1042", "Finance", "Move primary work location"],
        sections: 1,
      },
    ]) {
      await withTempDirectory(async (directory) => {
        const filename = path.join(directory, "input.pdf");
        await writeFile(filename, await readFile(path.resolve("tests/fixtures", fixture.name)));
        const result = await service.convert("pdf-to-word", filename, directory);
        const buffer = Buffer.from(result.bytes);
        const xml = await wordXml(buffer);
        for (const expected of fixture.text) expect(xml).toContain(expected);
        expect(xml).toContain("<w:tbl");
        expect(xml).toContain("<w:b");
        expect((xml.match(/<w:sectPr/g) ?? []).length).toBeGreaterThanOrEqual(fixture.sections);
        expect((await zipEntryNames(buffer)).some((name) => name.startsWith("word/media/"))).toBe(
          true,
        );
        await validateDocx(path.join(directory, "converted.docx"));
      });
    }
  }, 30000);
  it("truly removes selected PDF text before replacement and preserves its position and size", async () => {
    const input = new Uint8Array(
      await readFile(path.resolve("tests/fixtures/complex-timesheet.pdf")),
    );
    const before = await buildTextLayerModel(input);
    const approved = Object.values(before.pages)
      .flatMap((page) => page.blocks)
      .find((block) => block.text === "Approved");
    const finance = Object.values(before.pages)
      .flatMap((page) => page.blocks)
      .find((block) => block.text === "Finance");
    expect(approved).toBeDefined();
    expect(finance).toBeDefined();
    await withTempDirectory(async (directory) => {
      const inputPath = path.join(directory, "input.pdf");
      const editsPath = path.join(directory, "edits.json");
      const outputPath = path.join(directory, "edited.pdf");
      const statusPath = path.join(directory, "status.json");
      await writeFile(inputPath, input);
      await writeFile(
        editsPath,
        JSON.stringify([
          {
            id: approved!.id,
            pageIndex: approved!.pageIndex,
            x: approved!.x,
            y: approved!.y,
            width: approved!.width,
            height: approved!.height,
            originalText: approved!.text,
            replacementText: "Cleared",
            deleted: false,
          },
          {
            id: finance!.id,
            pageIndex: finance!.pageIndex,
            x: finance!.x,
            y: finance!.y,
            width: finance!.width,
            height: finance!.height,
            originalText: finance!.text,
            replacementText: "",
            deleted: true,
          },
        ]),
      );
      await runProcess(
        process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3"),
        [
          path.resolve("scripts/conversion/edit_pdf_text.py"),
          inputPath,
          editsPath,
          outputPath,
          statusPath,
        ],
        30000,
      );
      expect(JSON.parse(await readFile(statusPath, "utf8"))).toMatchObject({
        ok: true,
        applied: 2,
      });
      const output = new Uint8Array(await readFile(outputPath));
      const after = await buildTextLayerModel(output);
      const blocks = Object.values(after.pages).flatMap((page) => page.blocks);
      expect(blocks.some((block) => block.text === "Approved")).toBe(false);
      expect(blocks.some((block) => block.text === "Finance")).toBe(false);
      expect(blocks.some((block) => block.text === "Department")).toBe(true);
      const replacement = blocks.find((block) => block.text === "Cleared");
      expect(replacement).toBeDefined();
      expect(replacement!.x).toBeCloseTo(approved!.x, 0);
      expect(replacement!.y).toBeCloseTo(approved!.y, 0);
      expect(replacement!.fontSize).toBeCloseTo(approved!.fontSize, 0);
      expect((await PDFDocument.load(output)).getPageCount()).toBe(2);
    });
  }, 30000);
  it("replaces source text on a cropped and rotated page", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    page.drawText("Rotated source sentence", { x: 60, y: 600, size: 16 });
    page.setCropBox(20, 30, 550, 720);
    page.setRotation(degrees(90));
    const input = new Uint8Array(await document.save());
    const before = await buildTextLayerModel(input, 0);
    const source = before.pages[0].blocks.find((block) => block.text === "Rotated source sentence");
    expect(source).toBeDefined();
    await withTempDirectory(async (directory) => {
      const inputPath = path.join(directory, "input.pdf");
      const editsPath = path.join(directory, "edits.json");
      const outputPath = path.join(directory, "edited.pdf");
      const statusPath = path.join(directory, "status.json");
      await writeFile(inputPath, input);
      await writeFile(
        editsPath,
        JSON.stringify([
          {
            id: source!.id,
            pageIndex: 0,
            x: source!.x,
            y: source!.y,
            width: source!.width,
            height: source!.height,
            originalText: source!.text,
            replacementText: "Rotated replacement",
            deleted: false,
          },
        ]),
      );
      await runProcess(
        process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3"),
        [
          path.resolve("scripts/conversion/edit_pdf_text.py"),
          inputPath,
          editsPath,
          outputPath,
          statusPath,
        ],
        30000,
      );
      expect(JSON.parse(await readFile(statusPath, "utf8"))).toMatchObject({ ok: true });
      const after = await buildTextLayerModel(new Uint8Array(await readFile(outputPath)), 0);
      const text = after.pages[0].blocks.map((block) => block.text);
      expect(text).toContain("Rotated replacement");
      expect(text).not.toContain("Rotated source sentence");
      expect(
        (await PDFDocument.load(await readFile(outputPath))).getPage(0).getRotation().angle,
      ).toBe(90);
    });
  }, 30000);
  it("rejects malformed PDFs with a human-readable error", async () => {
    await withTempDirectory(async (directory) => {
      const filename = path.join(directory, "input.pdf");
      await writeFile(filename, "%PDF- broken");
      await expect(service.convert("pdf-to-word", filename, directory)).rejects.toMatchObject({
        code: "CONVERSION_FAILED",
      });
    });
  });
  it("terminates a hung conversion process", async () => {
    await expect(
      runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 200),
    ).rejects.toMatchObject({ code: "CONVERSION_TIMEOUT" });
  });
  it("bounds environment configuration", () => {
    vi.stubEnv("MAX_UPLOAD_MB", "-1");
    vi.stubEnv("CONVERSION_TIMEOUT_MS", "Infinity");
    expect(conversionConfig().maxBytes).toBe(50 * 1024 * 1024);
    expect(conversionConfig().timeoutMs).toBe(90000);
  });
});

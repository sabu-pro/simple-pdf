import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { Document, Packer, Paragraph } from "docx";
import { readFile } from "node:fs/promises";
import { buildTextLayerModel } from "../../src/lib/pdf/text-layer";

let pdf: Buffer, docx: Buffer;
test.beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage([400, 500]).drawText("Mobile compatibility sample", { x: 30, y: 450, size: 16 });
  pdf = Buffer.from(await document.save());
  docx = await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph("Test document")] }] }),
  );
});

type Missing = "iterator" | "toHex" | "getOrInsertComputed" | "withResolvers";
async function removePdfJsFeature(context: BrowserContext, missing: Missing) {
  const script = `(${function (feature: Missing) {
    if (feature === "iterator") {
      Reflect.deleteProperty(globalThis, "Iterator");
    } else if (feature === "toHex") {
      Reflect.deleteProperty(Uint8Array.prototype, "toHex");
    } else if (feature === "withResolvers") {
      Reflect.deleteProperty(Promise, "withResolvers");
      // Blob.arrayBuffer is also absent in older WebKit releases; the upload
      // must fall back to FileReader before PDF.js is started.
      Reflect.deleteProperty(Blob.prototype, "arrayBuffer");
    } else {
      Reflect.deleteProperty(Map.prototype, "getOrInsertComputed");
      Reflect.deleteProperty(WeakMap.prototype, "getOrInsertComputed");
    }
  }.toString()})(${JSON.stringify(missing)});\n`;
  await context.addInitScript(script);
  // A page polyfill never reaches a worker. Exercise both realms independently.
  await context.route("**/pdfjs/*worker*.mjs", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: script + (await response.text()) });
  });
}

async function uploadPdf(page: Page, route = "/edit") {
  await page.goto(route);
  await page
    .getByLabel("Choose PDF file", { exact: true })
    .setInputFiles({ name: "mobile.pdf", mimeType: "application/pdf", buffer: pdf });
}

for (const missing of ["iterator", "toHex", "getOrInsertComputed", "withResolvers"] as const) {
  test(`compatibility worker uploads, renders, edits and downloads without ${missing}`, async ({
    context,
    page,
  }, testInfo) => {
    await removePdfJsFeature(context, missing);
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    const workerResponse = page.waitForResponse("**/pdfjs/pdf.worker.legacy.min.mjs");
    const workerCreated = page.waitForEvent("worker");
    await uploadPdf(page);
    expect((await workerResponse).status()).toBe(200);
    expect((await workerCreated).url()).toContain("pdf.worker.legacy.min.mjs");
    await expect(page.locator(".editor-overlay")).toBeVisible();
    await expect(page.getByText("Rendering page…")).toBeHidden();
    await expect(page.locator(".notice-error")).toHaveCount(0);
    expect(
      await page
        .locator("canvas")
        .first()
        .evaluate((canvas: HTMLCanvasElement) => {
          const data = canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          return data.some((value, index) => index % 4 !== 3 && value < 100);
        }),
    ).toBe(true);
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await page.getByLabel("Text content", { exact: true }).fill("Verified edit");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    const download = await pending;
    const output = testInfo.outputPath("edited.pdf");
    await download.saveAs(output);
    const result = await PDFDocument.load(await readFile(output));
    expect(result.getPageCount()).toBe(1);
    const text = await buildTextLayerModel(new Uint8Array(await readFile(output)));
    expect(text.pages[0].blocks.map((block) => block.text).join(" ")).toContain("Verified edit");
    await expect(page.locator(".notice-error")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });
}

test.describe("modern PDF.js worker", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Desktop Chromium regression check");
  test("capable desktop keeps the existing modern worker", async ({ page }) => {
    const worker = page.waitForEvent("worker");
    await uploadPdf(page);
    expect((await worker).url()).toMatch(/\/pdfjs\/pdf\.worker\.min\.mjs$/);
    await expect(page.locator(".editor-overlay")).toBeVisible();
    await expect(page.getByText("Rendering page…")).toBeHidden();
    await expect(page.locator(".notice-error")).toHaveCount(0);
  });
});

test("PDF upload uses native FileReader when Blob.arrayBuffer is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Blob.prototype, "arrayBuffer");
  });
  await uploadPdf(page);
  await expect(page.locator(".editor-overlay")).toBeVisible();
  await expect(page.getByText("Rendering page…")).toBeHidden();
  await expect(page.locator(".notice-error")).toHaveCount(0);
});

for (const route of ["/edit", "/sign", "/merge", "/word-to-pdf", "/pdf-to-word"]) {
  test(`${route} hides unexpected file errors and allows the same file to be retried`, async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.addInitScript(() => {
      const read = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () {
        Blob.prototype.arrayBuffer = read;
        return Promise.reject(new TypeError("undefined is not a function — PRIVATE_STACK"));
      };
    });
    await page.goto(route);
    const word = route === "/word-to-pdf";
    const input = page.getByLabel(
      word ? "Choose DOCX file" : route === "/merge" ? "Choose PDF files" : "Choose PDF file",
      { exact: true },
    );
    const file = {
      name: word ? "sample.docx" : "sample.pdf",
      mimeType: word
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
      buffer: word ? docx : pdf,
    };
    await input.setInputFiles(file);
    await expect(page.locator(".notice-error")).toContainText("Something went wrong loading");
    await expect(page.locator("body")).not.toContainText("PRIVATE_STACK");
    await expect(input).toBeEnabled();
    await input.setInputFiles(file);
    if (route === "/edit" || route === "/sign") {
      await expect(page.locator(".editor-overlay")).toBeVisible();
    } else {
      await expect(page.getByText(file.name, { exact: true })).toBeVisible();
    }
    await expect(page.locator(".notice-error")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });
}

test("PDF to Word hides server exception strings", async ({ page }) => {
  await page.route("**/api/pdf-to-word-worker", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PROCESSING_ERROR",
        error: "undefined is not a function — PRIVATE_STACK",
      }),
    }),
  );
  await uploadPdf(page, "/pdf-to-word");
  await page.getByRole("button", { name: "Convert to Word", exact: true }).click();
  await expect(page.locator(".notice-error")).toContainText("Please try again");
  await expect(page.locator("body")).not.toContainText("PRIVATE_STACK");
});

test("PDF to Word catches synchronous upload failures", async ({ page }) => {
  await uploadPdf(page, "/pdf-to-word");
  await page.evaluate(() => {
    XMLHttpRequest.prototype.send = () => {
      throw new TypeError("PRIVATE_STACK");
    };
  });
  await page.getByRole("button", { name: "Convert to Word", exact: true }).click();
  await expect(page.locator(".notice-error")).toContainText("Something went wrong uploading");
  await expect(page.locator("body")).not.toContainText("PRIVATE_STACK");
  await expect(page.getByRole("button", { name: "Convert to Word", exact: true })).toBeEnabled();
});

test("PDF worker load failure shows a friendly error and retry succeeds", async ({
  page,
  context,
}) => {
  await context.route("**/pdfjs/*worker*.mjs", (route) => route.abort());
  await uploadPdf(page);
  await expect(page.locator(".notice-error")).toContainText(
    "Something went wrong loading this PDF",
  );
  await context.unroute("**/pdfjs/*worker*.mjs");
  // PDF.js caches a failed fake-worker import; reloading is the recovery path.
  await uploadPdf(page);
  await expect(page.locator(".editor-overlay")).toBeVisible();
  await expect(page.getByText("Rendering page…")).toBeHidden();
  await expect(page.locator(".notice-error")).toHaveCount(0);
});

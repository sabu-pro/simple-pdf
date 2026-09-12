import { test, expect } from "@playwright/test";
import { PDFDocument, degrees } from "pdf-lib";
import { Document, Packer, Paragraph } from "docx";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { buildTextLayerModel } from "../../src/lib/pdf/text-layer";

const fixtures = path.resolve(".local/fixtures"),
  screenshots = path.resolve(".local/screenshots");
test.beforeAll(async () => {
  await mkdir(fixtures, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([612, 792]);
  first.drawText("A fresh perspective.", { x: 60, y: 710, size: 28 });
  first.drawText("A real sample document for SimplePDF.", { x: 60, y: 665, size: 14 });
  first.drawText("Add your notes and signature below.", { x: 60, y: 630, size: 14 });
  const second = pdf.addPage([612, 792]);
  second.drawText("Second page: rotated and cropped", { x: 60, y: 600, size: 16 });
  second.setCropBox(20, 30, 550, 720);
  second.setRotation(degrees(90));
  await writeFile(path.join(fixtures, "sample.pdf"), await pdf.save());
  const other = await PDFDocument.create();
  other.addPage([400, 500]).drawText("Second file", { x: 40, y: 430, size: 22 });
  await writeFile(path.join(fixtures, "second.pdf"), await other.save());
  const blank = await PDFDocument.create();
  blank.addPage([612, 792]);
  await writeFile(path.join(fixtures, "scan.pdf"), await blank.save());
  await writeFile(
    path.join(fixtures, "sample.docx"),
    await Packer.toBuffer(
      new Document({ sections: [{ children: [new Paragraph("SimplePDF Word conversion test")] }] }),
    ),
  );
  const signature = createCanvas(300, 100),
    context = signature.getContext("2d");
  context.font = "40px cursive";
  context.fillText("Alex Morgan", 15, 65);
  await writeFile(path.join(fixtures, "signature.png"), signature.toBuffer("image/png"));
});

test("homepage, five tools, and mobile navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("PDF editing");
  await expect(page.locator(".tool-card")).toHaveCount(5);
  await expect(page.locator("footer")).toContainText("© 2026 SimplePDF. Built by Sabut B K.");
  await page.screenshot({ path: path.join(screenshots, "home-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Merge PDF", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One PDF");
  await page.screenshot({ path: path.join(screenshots, "merge-mobile.png"), fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test("editor creates, moves, resizes, undoes, signs and exports real overlays", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/edit");
  await page
    .getByLabel("Choose PDF file", { exact: true })
    .setInputFiles(path.join(fixtures, "sample.pdf"));
  await expect(page.locator(".editor-overlay")).toBeVisible();
  await expect(page.getByText("Rendering page…")).toBeHidden();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page.getByLabel("Text content", { exact: true }).fill("Reviewed and approved");
  await page.getByLabel("Font size (pt)").fill("24");
  await page.getByRole("button", { name: "Bold text" }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit page to width" }).click();
  const object = page.getByRole("button", { name: "Text: Reviewed and approved", exact: true });
  await object.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const box = await object.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 20, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(box!.x + 90, box!.y + 110, { steps: 5 });
  await page.mouse.up();
  const handle = page.locator("[data-resize]");
  const resize = await handle.boundingBox();
  await page.mouse.move(resize!.x + resize!.width / 2, resize!.y + resize!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize!.x + 40, resize!.y + 15, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  const sheet = await page.locator(".editor-overlay").boundingBox();
  await page.mouse.move(sheet!.x + 65, sheet!.y + 170);
  await page.mouse.down();
  await page.mouse.move(sheet!.x + 290, sheet!.y + 190, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.mouse.move(sheet!.x + 80, sheet!.y + 270);
  await page.mouse.down();
  await page.mouse.move(sheet!.x + 170, sheet!.y + 305, { steps: 6 });
  await page.mouse.move(sheet!.x + 250, sheet!.y + 275, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  await page.getByRole("tab", { name: "Type", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Alex Morgan");
  await page.getByRole("button", { name: "Place signature" }).click();
  await expect(page.getByRole("button", { name: "signature addition", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, "editor-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByLabel("Current page")).toHaveValue("1");
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page.getByLabel("Text content", { exact: true }).fill("Rotated page note");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await pending;
  const output = path.join(fixtures, "edited.pdf");
  await download.saveAs(output);
  expect((await PDFDocument.load(await readFile(output))).getPageCount()).toBe(2);
  await expect(page.locator(".notice-error")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Fit page to width" }).click();
  await page.screenshot({ path: path.join(screenshots, "editor-mobile.png"), fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test("editor replaces and deletes original text without leaving the old glyphs", async ({
  page,
}) => {
  await page.goto("/edit");
  await page
    .getByLabel("Choose PDF file", { exact: true })
    .setInputFiles(path.resolve("tests/fixtures/complex-timesheet.pdf"));
  await expect(page.getByText("Rendering page…")).toBeHidden();
  await page.getByRole("button", { name: "Existing PDF text: Approved", exact: true }).click();
  await page.getByLabel("Replacement text").fill("Cleared");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await page.getByRole("button", { name: "Existing PDF text: Finance", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await pending;
  const output = path.join(fixtures, "source-edited.pdf");
  await download.saveAs(output);
  const model = await buildTextLayerModel(new Uint8Array(await readFile(output)));
  const text = Object.values(model.pages).flatMap((item) => item.blocks.map((block) => block.text));
  expect(text).toContain("Cleared");
  expect(text).not.toContain("Approved");
  expect(text).not.toContain("Finance");
  await expect(page.locator(".notice-error")).toHaveCount(0);
});

test("drawn and uploaded signatures are placed", async ({ page }) => {
  await page.goto("/sign");
  await page
    .getByLabel("Choose PDF file", { exact: true })
    .setInputFiles(path.join(fixtures, "sample.pdf"));
  await expect(page.getByRole("dialog")).toBeVisible();
  const canvas = await page.locator(".signature-canvas").boundingBox();
  await page.mouse.move(canvas!.x + 35, canvas!.y + 60);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + 130, canvas!.y + 100, { steps: 8 });
  await page.mouse.move(canvas!.x + 220, canvas!.y + 50, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Place signature" }).click();
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  await page.getByRole("tab", { name: "Upload", exact: true }).click();
  await page
    .getByLabel("Signature image (PNG or JPG, up to 5 MB)")
    .setInputFiles(path.join(fixtures, "signature.png"));
  await expect(page.getByRole("img", { name: "Uploaded signature preview" })).toBeVisible();
  await page.getByRole("button", { name: "Place signature" }).click();
  await expect(page.getByRole("button", { name: "signature addition", exact: true })).toHaveCount(
    2,
  );
});

test("merge exports files in the chosen order", async ({ page }) => {
  await page.goto("/merge");
  await page
    .getByLabel("Choose PDF files", { exact: true })
    .setInputFiles([path.join(fixtures, "sample.pdf"), path.join(fixtures, "second.pdf")]);
  await expect(page.getByText("2 files · 3 total pages")).toBeVisible();
  await page.getByRole("button", { name: "Move second.pdf up", exact: true }).click();
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download merged PDF" }).click();
  const download = await pending;
  const output = path.join(fixtures, "merged.pdf");
  await download.saveAs(output);
  const document = await PDFDocument.load(await readFile(output));
  expect(document.getPageCount()).toBe(3);
  expect(document.getPage(0).getWidth()).toBe(400);
});

test("PDF to Word downloads a DOCX and explains scans", async ({ page }) => {
  await page.goto("/pdf-to-word");
  await page
    .getByLabel("Choose PDF file", { exact: true })
    .setInputFiles(path.resolve("tests/fixtures/complex-timesheet.pdf"));
  await page.getByRole("button", { name: "Convert to Word", exact: true }).click();
  await expect(page.getByText("Done! Your Word document is ready.")).toBeVisible({
    timeout: 90000,
  });
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Word document" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("complex-timesheet.docx");
  await page.getByRole("button", { name: "Remove selected file" }).click();
  await page
    .getByLabel("Choose PDF file", { exact: true })
    .setInputFiles(path.join(fixtures, "scan.pdf"));
  await page.getByRole("button", { name: "Convert to Word", exact: true }).click();
  await expect(page.locator(".notice-error")).toContainText("OCR", { timeout: 90000 });
});

test("Word conversion reports the actual server capability", async ({ page, request }) => {
  const capabilities = await (await request.get("/api/capabilities")).json();
  await page.goto("/word-to-pdf");
  await page
    .getByLabel("Choose DOCX file", { exact: true })
    .setInputFiles(path.join(fixtures, "sample.docx"));
  if (!capabilities.wordToPdf) {
    await expect(
      page.getByText("Word to PDF needs LibreOffice on this server.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Convert to PDF", exact: true })).toBeDisabled();
  } else {
    await page.getByRole("button", { name: "Convert to PDF", exact: true }).click();
    await expect(page.getByText("Done! Your PDF is ready.")).toBeVisible({ timeout: 90000 });
  }
});

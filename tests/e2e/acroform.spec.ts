import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

for (const fixture of ["complex-form.pdf", "embedded-form.pdf"]) {
  test(`Edit downloads ${fixture} as static page content`, async ({ page }, testInfo) => {
    await page.goto("/edit");
    await page
      .getByLabel("Choose PDF file", { exact: true })
      .setInputFiles(path.resolve("tests/fixtures", fixture));
    await expect(page.locator(".editor-overlay")).toBeVisible();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    const download = await pending;
    const output = testInfo.outputPath(fixture);
    await download.saveAs(output);
    await expect(page.locator(".notice-error")).toHaveCount(0);
    const pdf = await PDFDocument.load(await readFile(output));
    expect(pdf.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    for (const pdfPage of pdf.getPages()) {
      for (const ref of pdfPage.node.Annots()?.asArray() ?? []) {
        expect(pdf.context.lookup(ref, PDFDict).get(PDFName.of("Subtype"))).not.toBe(
          PDFName.of("Widget"),
        );
      }
    }
    // Reopening in the editor extracts former field values as ordinary page text.
    await page.reload();
    await page.getByLabel("Choose PDF file", { exact: true }).setInputFiles(output);
    await expect(
      page.getByRole("button", {
        name: `Existing PDF text: ${fixture === "complex-form.pdf" ? "Alex Morgan" : "Jordan Lee"}`,
        exact: true,
      }),
    ).toBeVisible();
  });
}

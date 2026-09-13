"use client";
import { ensurePromiseWithResolvers, needsLegacyPdfJs } from "./compatibility";

let library: Promise<typeof import("pdfjs-dist")> | undefined;
export async function getPdfJs() {
  if (!library) {
    // Decide before importing: the legacy bundle installs polyfills in this realm.
    // Workers have their own globals, so they need the matching legacy bundle too.
    const legacy = needsLegacyPdfJs();
    if (legacy) ensurePromiseWithResolvers();
    library = (legacy ? import("pdfjs-dist/legacy/build/pdf.mjs") : import("pdfjs-dist"))
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = legacy
          ? "/pdfjs/pdf.worker.legacy.min.mjs"
          : "/pdfjs/pdf.worker.min.mjs";
        return pdfjs;
      })
      .catch((error) => {
        library = undefined;
        throw error;
      });
  }
  return library;
}
export async function openBrowserPdf(bytes: Uint8Array) {
  const pdfjs = await getPdfJs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    throw error;
  }
}

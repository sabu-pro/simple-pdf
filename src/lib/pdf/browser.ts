"use client";
import { ensurePromiseWithResolvers, needsLegacyPdfJs } from "./compatibility";

type PdfJsLibrary = typeof import("pdfjs-dist");
let library: Promise<PdfJsLibrary> | undefined;
let compatibilityRenderer = false;
export async function getPdfJs() {
  if (!library) {
    // Current PDF.js legacy builds still contain syntax that iOS 17 cannot parse.
    // Keep PDF.js 6 on capable browsers and use the last known-compatible renderer elsewhere.
    compatibilityRenderer = needsLegacyPdfJs();
    if (compatibilityRenderer) ensurePromiseWithResolvers();
    library = (
      compatibilityRenderer
        ? import("pdfjs-dist-mobile/legacy/build/pdf.mjs")
        : import("pdfjs-dist")
    )
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = compatibilityRenderer
          ? "/pdfjs/pdf.worker.mobile-5.4.54.min.mjs"
          : "/pdfjs/pdf.worker.min.mjs";
        return pdfjs as unknown as PdfJsLibrary;
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
    cMapUrl: compatibilityRenderer ? "/pdfjs/mobile/cmaps/" : "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: compatibilityRenderer
      ? "/pdfjs/mobile/standard_fonts/"
      : "/pdfjs/standard_fonts/",
    wasmUrl: compatibilityRenderer ? "/pdfjs/mobile/wasm/" : "/pdfjs/wasm/",
    ...(compatibilityRenderer
      ? {
          isOffscreenCanvasSupported: false,
          isImageDecoderSupported: false,
          useWorkerFetch: false,
        }
      : {}),
  });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    throw error;
  }
}

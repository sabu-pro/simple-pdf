"use client";
let library: Promise<typeof import("pdfjs-dist")> | undefined;
export async function getPdfJs() {
  library ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return pdfjs;
  });
  return library;
}
export async function openBrowserPdf(bytes: Uint8Array) {
  const pdfjs = await getPdfJs();
  return pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  }).promise;
}

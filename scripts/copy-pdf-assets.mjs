import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("public/pdfjs", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdfjs/pdf.worker.min.mjs",
);
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
}

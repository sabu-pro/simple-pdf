import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("public/pdfjs", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdfjs/pdf.worker.min.mjs",
);
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
}

const conversionFonts = {
  arimo: "Arimo",
  tinos: "Tinos",
  cousine: "Cousine",
  carlito: "Carlito",
  caladea: "Caladea",
};
const fontVariants = ["400Regular", "400Regular_Italic", "700Bold", "700Bold_Italic"];
for (const [packageName, familyName] of Object.entries(conversionFonts)) {
  const destination = `public/ream-fonts/${packageName}`;
  await mkdir(destination, { recursive: true });
  for (const variant of fontVariants) {
    const filename = `${familyName}_${variant}.ttf`;
    await copyFile(
      `node_modules/@expo-google-fonts/${packageName}/${variant}/${filename}`,
      `${destination}/${filename}`,
    );
  }
}

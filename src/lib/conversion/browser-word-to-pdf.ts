import { Ream, type Loss } from "reamkit";

const FONT_CDN = "https://cdn.jsdelivr.net/npm/@expo-google-fonts/";
const BUNDLED_FAMILIES = new Set(["arimo", "tinos", "cousine", "carlito", "caladea"]);

function bundledFontFetch(url: string) {
  if (url.startsWith(FONT_CDN)) {
    const path = url.slice(FONT_CDN.length);
    const [family] = path.split("/");
    const filename = path.split("/").at(-1);
    if (family && filename && BUNDLED_FAMILIES.has(family)) {
      return fetch(`/ream-fonts/${family}/${filename}`);
    }
  }
  return fetch(url);
}

function warningsFor(losses: ReadonlyArray<Loss>) {
  const warnings = [
    "Fonts that are not embedded in the DOCX are replaced with open metric-compatible fonts.",
  ];
  const changed = losses.filter((loss) => loss.severity === "dropped" || loss.severity === "degraded");
  if (changed.length) {
    warnings.push(
      `${changed.length} document feature${changed.length === 1 ? "" : "s"} could not be reproduced exactly. Review the PDF before sharing.`,
    );
  }
  return warnings;
}

export async function convertWordToPdf(bytes: Uint8Array) {
  const document = Ream.parse(bytes);
  if (document.format !== "docx") throw new Error("Choose a valid DOCX Word document.");
  const result = await document.convertWithReport("pdf", { fontFetch: bundledFontFetch });
  if (
    result.bytes.length < 5 ||
    new TextDecoder().decode(result.bytes.subarray(0, 5)) !== "%PDF-"
  ) {
    throw new Error("The PDF could not be created from this document.");
  }
  return { bytes: result.bytes, warnings: warningsFor(result.losses) };
}

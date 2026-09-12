import type { Metadata } from "next";
import { ConversionTool } from "@/components/conversion-tool";
export const metadata: Metadata = { title: "PDF to Word" };
export default function PdfToWordPage() {
  return <ConversionTool direction="pdf-to-word" />;
}

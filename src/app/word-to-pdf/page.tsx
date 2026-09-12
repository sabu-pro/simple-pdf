import type { Metadata } from "next";
import { ConversionTool } from "@/components/conversion-tool";
export const metadata: Metadata = { title: "Word to PDF" };
export default function WordToPdfPage() {
  return <ConversionTool direction="word-to-pdf" />;
}

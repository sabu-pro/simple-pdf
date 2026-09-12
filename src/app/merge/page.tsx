import type { Metadata } from "next";
import { MergeTool } from "@/components/merge-tool";
export const metadata: Metadata = { title: "Merge PDF" };
export default function MergePage() {
  return <MergeTool />;
}

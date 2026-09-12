import type { Metadata } from "next";
import { Editor } from "@/components/editor/editor";
export const metadata: Metadata = { title: "Edit PDF" };
export default function EditPage() {
  return <Editor />;
}

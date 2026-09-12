import type { Metadata } from "next";
import { Editor } from "@/components/editor/editor";
export const metadata: Metadata = { title: "Sign PDF" };
export default function SignPage() {
  return <Editor signing />;
}

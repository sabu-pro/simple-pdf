import { validateSourceTextEdits } from "./source-edits";
import type { SourceTextEdit } from "@/types/editor";

export async function applySourceTextEdits(
  bytes: Uint8Array,
  filename: string,
  edits: SourceTextEdit[],
) {
  const validated = validateSourceTextEdits(edits);
  const data = new FormData();
  data.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), filename);
  data.append("edits", JSON.stringify(validated));
  const response = await fetch("/api/edit-text-worker", { method: "POST", body: data });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "We couldn’t apply the source text edits.");
  }
  let warnings: string[] = [];
  try {
    warnings = JSON.parse(decodeURIComponent(response.headers.get("X-Edit-Warnings") || "%5B%5D"));
  } catch {
    warnings = [];
  }
  return { bytes: new Uint8Array(await response.arrayBuffer()), warnings };
}

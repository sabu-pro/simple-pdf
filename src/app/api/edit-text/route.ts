import path from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { conversionConfig } from "@/lib/conversion/config";
import { ConversionError } from "@/lib/conversion/errors";
import { runProcess } from "@/lib/conversion/process";
import { isSameOrigin } from "@/lib/files/origin";
import { withTempDirectory } from "@/lib/files/temp";
import { receiveTextEditUpload } from "@/lib/files/upload";
import { validateSourceTextEdits } from "@/lib/pdf/source-edits";

export const runtime = "nodejs";
export const maxDuration = 180;
let activeJobs = 0;

type EditStatus = {
  ok: boolean;
  code?: string;
  message?: string;
  warnings?: string[];
};

async function forwardToVercelWorker(request: Request) {
  const contentType = request.headers.get("content-type");
  if (!contentType) return Response.json({ error: "Choose a PDF to edit." }, { status: 400 });
  try {
    const deploymentHost = process.env.VERCEL_URL;
    if (!deploymentHost) throw new Error("Missing deployment host");
    const headers = new Headers({ "Content-Type": contentType });
    return await fetch(`https://${deploymentHost}/api/edit-text-worker`, {
      method: "POST",
      headers,
      body: await request.arrayBuffer(),
      signal: request.signal,
    });
  } catch {
    return Response.json(
      { error: "The hosted text-editing service could not be reached. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return Response.json({ error: "Use the PDF editor on this site." }, { status: 403 });
  if (process.env.VERCEL === "1") return forwardToVercelWorker(request);
  if (activeJobs >= 2)
    return Response.json(
      { error: "Two PDFs are already being processed. Please try again shortly." },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  activeJobs++;
  try {
    const result = await withTempDirectory(async (directory) => {
      const upload = await receiveTextEditUpload(request, directory, conversionConfig().maxBytes);
      let edits;
      try {
        edits = validateSourceTextEdits(JSON.parse(upload.edits));
      } catch (error) {
        throw new ConversionError(
          error instanceof Error ? error.message : "The text edit request is invalid.",
          "INVALID_EDITS",
          400,
        );
      }
      const editsPath = path.join(directory, "edits.json");
      const output = path.join(directory, "edited.pdf");
      const statusPath = path.join(directory, "status.json");
      await writeFile(editsPath, JSON.stringify(edits), { encoding: "utf8", mode: 0o600 });
      try {
        await runProcess(
          process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3"),
          [
            path.resolve("scripts/conversion/edit_pdf_text.py"),
            upload.input,
            editsPath,
            output,
            statusPath,
          ],
          conversionConfig().timeoutMs,
          { signal: request.signal },
        );
      } catch (error) {
        if (request.signal.aborted) throw error;
        if (error instanceof Error && /not found|not recognized|ENOENT/i.test(error.message)) {
          throw new ConversionError(
            "Original-text editing needs the free PyMuPDF service on this server.",
            "TEXT_EDIT_ENGINE_UNAVAILABLE",
            503,
          );
        }
        throw error;
      }
      let status: EditStatus;
      try {
        status = JSON.parse(await readFile(statusPath, "utf8"));
      } catch {
        throw new ConversionError(
          "The text edit did not finish correctly. Please try again.",
          "TEXT_EDIT_FAILED",
        );
      }
      if (status.code === "PYTHON_DEPENDENCIES")
        throw new ConversionError(
          "Original-text editing needs the free PyMuPDF package on this server. Install the conversion requirements, then restart SimplePDF.",
          "TEXT_EDIT_ENGINE_UNAVAILABLE",
          503,
        );
      if (!status.ok)
        throw new ConversionError(
          status.message || "The selected source text could not be edited safely.",
          status.code || "TEXT_EDIT_FAILED",
        );
      if ((await stat(output)).size > 100 * 1024 * 1024)
        throw new ConversionError(
          "The edited PDF exceeds the output size limit.",
          "OUTPUT_TOO_LARGE",
        );
      return { bytes: await readFile(output), warnings: status.warnings ?? [] };
    });
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="edited.pdf"',
        "Cache-Control": "no-store",
        "X-Edit-Warnings": encodeURIComponent(JSON.stringify(result.warnings)),
      },
    });
  } catch (error) {
    const known = error instanceof ConversionError;
    return Response.json(
      {
        error: known ? error.message : "We couldn’t apply these source text edits.",
        code: known ? error.code : "PROCESSING_ERROR",
      },
      { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    activeJobs--;
  }
}

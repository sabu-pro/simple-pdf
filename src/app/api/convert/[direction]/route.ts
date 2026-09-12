import { conversionConfig } from "@/lib/conversion/config";
import { ConversionError } from "@/lib/conversion/errors";
import { conversionService } from "@/lib/conversion/service";
import { withTempDirectory } from "@/lib/files/temp";
import { receiveUpload } from "@/lib/files/upload";
import { isSameOrigin } from "@/lib/files/origin";

export const runtime = "nodejs";
export const maxDuration = 180;
// Per-process admission control. Public deployments also need an ingress rate limit.
let activeJobs = 0;
export async function POST(request: Request, context: { params: Promise<{ direction: string }> }) {
  const { direction } = await context.params;
  if (direction !== "word-to-pdf" && direction !== "pdf-to-word")
    return Response.json({ error: "Unknown conversion tool." }, { status: 404 });
  if (!isSameOrigin(request))
    return Response.json({ error: "Use the conversion form on this site." }, { status: 403 });
  if (activeJobs >= 2)
    return Response.json(
      { error: "Two documents are already being processed. Please try again shortly." },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  activeJobs++;
  try {
    const result = await withTempDirectory(async (directory) => {
      const input = await receiveUpload(
        request,
        directory,
        direction === "word-to-pdf" ? "docx" : "pdf",
        conversionConfig().maxBytes,
      );
      return conversionService.convert(direction, input, directory, request.signal);
    });
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Content-Type": result.mime,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Conversion-Warnings": encodeURIComponent(JSON.stringify(result.warnings)),
      },
    });
  } catch (error) {
    const known = error instanceof ConversionError;
    return Response.json(
      {
        error: known
          ? error.message
          : "We couldn’t process this document. Please try a different file.",
        code: known ? error.code : "PROCESSING_ERROR",
      },
      { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    activeJobs--;
  }
}

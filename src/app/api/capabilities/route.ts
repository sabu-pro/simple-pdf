import { findLibreOffice } from "@/lib/conversion/libreoffice";
import { conversionConfig } from "@/lib/conversion/config";
import { pdfToWordAvailable } from "@/lib/conversion/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    {
      wordToPdf: !!(await findLibreOffice()),
      pdfToWord: await pdfToWordAvailable(),
      maxUploadBytes: conversionConfig().maxBytes,
      maxPdfPages: conversionConfig().maxPages,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

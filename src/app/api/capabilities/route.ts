import { conversionConfig } from "@/lib/conversion/config";
import { pdfToWordAvailable } from "@/lib/conversion/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const hosted = !!process.env.VERCEL;
  return Response.json(
    {
      wordToPdf: true,
      pdfToWord: hosted || (await pdfToWordAvailable()),
      maxUploadBytes: conversionConfig().maxBytes,
      maxPdfToWordBytes: hosted ? 4_000_000 : conversionConfig().maxBytes,
      maxPdfPages: conversionConfig().maxPages,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

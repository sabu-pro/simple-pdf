import { Document, Packer, Paragraph, TextRun } from "docx";

/** Generate actual editable Word paragraphs, separated by source PDF pages. */
export async function generateDocx(pages) {
  const document = new Document({
    creator: "SimplePDF",
    title: "Converted document",
    description: "Editable text extracted from a PDF",
    sections: pages.map((page, index) => ({
      properties: {
        page: {
          size: {
            width: Math.round(Math.max(144, Math.min(1584, page.width)) * 20),
            height: Math.round(Math.max(144, Math.min(1584, page.height)) * 20),
          },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: page.paragraphs.length
        ? page.paragraphs.map(
            (paragraph) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: paragraph.text,
                    size: Math.round(paragraph.size * 2),
                    font: "Arial",
                  }),
                ],
                spacing: { after: 120 },
                indent: {
                  left: Math.max(0, Math.min(1440, Math.round((paragraph.indent - 36) * 20))),
                },
              }),
          )
        : [
            new Paragraph({
              children: [
                new TextRun({
                  text: `[Page ${index + 1} has no extractable text. OCR may be needed.]`,
                  italics: true,
                  color: "666666",
                }),
              ],
            }),
          ],
    })),
  });
  return Packer.toBuffer(document);
}

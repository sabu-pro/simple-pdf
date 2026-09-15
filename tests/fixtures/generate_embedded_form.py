"""Build a real AcroForm with an embedded font and a stale appearance.

Run from the repo root after npm install. The field's font is inherited from
AcroForm /DA and /DR; /NeedAppearances asks a viewer to repaint its new value.
"""
import io
from pathlib import Path

import pymupdf
from reportlab.lib.colors import white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "node_modules/@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf"
pdfmetrics.registerFont(TTFont("OriginalBold", str(FONT)))
buffer = io.BytesIO()
pdf = canvas.Canvas(buffer, pagesize=(360, 240), invariant=True)
pdf.setTitle("Embedded font AcroForm regression")
pdf.setFont("OriginalBold", 14)
pdf.setFillColorRGB(0.1, 0.2, 0.3)
pdf.drawString(20, 205, "Employee name")
pdf.acroForm.textfield(
    name="employee_name", value="Jordan Lee", x=20, y=160,
    width=220, height=24, fontName="Helvetica", fontSize=14,
    borderWidth=0, forceBorder=False, fillColor=white,
)
pdf.showPage()
pdf.save()

with pymupdf.open(stream=buffer.getvalue(), filetype="pdf") as document:
    page = document[0]
    embedded = next(font[0] for font in page.get_fonts() if "Arimo" in font[3])
    acroform = int(document.xref_get_key(document.pdf_catalog(), "AcroForm")[1].split()[0])
    document.xref_set_key(acroform, "DR/Font/OriginalBold", f"{embedded} 0 R")
    document.xref_set_key(acroform, "DA", "(/OriginalBold 14 Tf 0.1 0.2 0.3 rg)")
    document.xref_set_key(acroform, "NeedAppearances", "true")
    widget = next(page.widgets())
    document.xref_set_key(widget.xref, "DA", "null")
    appearance = document.get_new_xref()
    document.update_object(appearance, (
        "<< /Type /XObject /Subtype /Form /BBox [0 0 220 24] "
        f"/Resources << /Font << /OriginalBold {embedded} 0 R >> >> >>"
    ))
    document.update_stream(appearance, (
        b"BT /OriginalBold 14 Tf 0.1 0.2 0.3 rg "
        b"1 0 0 1 2 6 Tm (Alex Morgan) Tj ET"
    ))
    document.xref_set_key(widget.xref, "AP", f"<< /N {appearance} 0 R >>")
    document.save(Path(__file__).with_name("embedded-form.pdf"), deflate=True, no_new_id=True)

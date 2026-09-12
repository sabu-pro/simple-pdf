"""Generate deterministic complex PDFs used by SimplePDF integration tests."""
from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    Image as FlowImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def logo_bytes() -> io.BytesIO:
    image = Image.new("RGB", (280, 80), "#eef8f5")
    drawing = ImageDraw.Draw(image)
    drawing.rounded_rectangle((3, 3, 277, 77), radius=18, fill="#0b8068")
    drawing.ellipse((20, 18, 62, 60), fill="#f6c776")
    drawing.text((78, 26), "SIMPLE WORKS", fill="white")
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    stream.seek(0)
    return stream


def build_timesheet(target: Path):
    page_size = landscape(letter)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="CentreSmall", parent=styles["BodyText"], alignment=TA_CENTER, fontSize=8))
    styles.add(ParagraphStyle(name="RightSmall", parent=styles["BodyText"], alignment=TA_RIGHT, fontSize=8))

    def decorate_page(pdf, document):
        width, height = page_size
        pdf.saveState()
        pdf.setFillColor(colors.HexColor("#0b8068"))
        pdf.rect(0, height - 34, width, 34, fill=1, stroke=0)
        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(30, height - 22, "SIMPLE WORKS · WEEKLY TIMESHEET")
        pdf.setFillColor(colors.HexColor("#596a66"))
        pdf.setFont("Helvetica", 8)
        pdf.drawString(30, 18, "Confidential payroll record")
        pdf.drawRightString(width - 30, 18, f"Page {document.page}")
        pdf.restoreState()

    document = SimpleDocTemplate(
        str(target),
        pagesize=page_size,
        leftMargin=30,
        rightMargin=30,
        topMargin=46,
        bottomMargin=34,
        title="Complex Timesheet",
        author="SimplePDF test suite",
    )
    story = [
        Table(
            [
                [FlowImage(logo_bytes(), width=2.1 * inch, height=0.6 * inch), Paragraph("<b>Employee</b><br/>Alex Morgan", styles["BodyText"]), Paragraph("<b>Department</b><br/><font color='#6a3fc1'>Finance</font>", styles["BodyText"]), Paragraph("<b>Week ending</b><br/>12 September 2026", styles["RightSmall"])],
            ],
            colWidths=[2.3 * inch, 2.2 * inch, 1.8 * inch, 2.5 * inch],
        ),
        Spacer(1, 14),
        Paragraph("<b>Hours and project allocation</b>", styles["Heading2"]),
        Spacer(1, 6),
    ]
    rows = [[Paragraph("<b>Day</b>", styles["CentreSmall"]), Paragraph("<b>Project / task</b>", styles["CentreSmall"]), Paragraph("<b>Start</b>", styles["CentreSmall"]), Paragraph("<b>Finish</b>", styles["CentreSmall"]), Paragraph("<b>Break</b>", styles["CentreSmall"]), Paragraph("<b>Regular</b>", styles["CentreSmall"]), Paragraph("<b>Overtime</b>", styles["CentreSmall"]), Paragraph("<b>Notes</b>", styles["CentreSmall"])]]
    values = [
        ("Monday", "Client onboarding", "08:30", "17:00", "0:30", "8.0", "0.0", "Kick-off and access review"),
        ("Tuesday", "Quarterly reporting", "08:15", "18:00", "0:45", "8.0", "1.0", "<i>Variance analysis</i>"),
        ("Wednesday", "Forms migration", "09:00", "17:30", "0:30", "8.0", "0.0", "Mapped 14 workflows"),
        ("Thursday", "Forms migration", "08:30", "19:00", "0:30", "8.0", "2.0", "User acceptance test"),
        ("Friday", "Operations", "08:30", "16:30", "0:30", "7.5", "0.0", "Team retrospective"),
    ]
    for row in values:
        rows.append([Paragraph(value, styles["CentreSmall"] if index != 1 and index != 7 else styles["BodyText"]) for index, value in enumerate(row)])
    rows.append([Paragraph("<b>Total</b>", styles["RightSmall"]), "", "", "", "", Paragraph("<b>39.5</b>", styles["CentreSmall"]), Paragraph("<b>3.0</b>", styles["CentreSmall"]), ""])
    table = Table(rows, colWidths=[0.72 * inch, 1.7 * inch, 0.62 * inch, 0.62 * inch, 0.58 * inch, 0.65 * inch, 0.65 * inch, 2.3 * inch], repeatRows=1, rowHeights=[28] + [38] * 5 + [26])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dcefea")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#fff3db")),
        ("GRID", (0, 0), (-1, -1), 0.65, colors.HexColor("#6c7f79")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("SPAN", (0, -1), (4, -1)),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([
        table,
        Spacer(1, 14),
        Table(
            [[Paragraph("<b>Employee declaration</b><br/>I confirm these hours are accurate.<br/><br/>Signed: <i>Alex Morgan</i>", styles["BodyText"]), Paragraph("<b>Manager approval</b><br/>Name: Jordan Lee<br/><br/>Status: <font color='#0b8068'><b>Approved</b></font>", styles["BodyText"]) ]],
            colWidths=[4.45 * inch, 4.45 * inch],
            style=TableStyle([("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#6c7f79")), ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9aaba6")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]),
        ),
        PageBreak(),
        Paragraph("<b>Project notes and allocation rules</b>", styles["Heading2"]),
        Spacer(1, 10),
        Table(
            [[Paragraph("<b>Project notes</b><br/><br/>The migration work covered intake forms, approvals, validation and archive rules. Keep client data within the approved workspace.<br/><br/><i>Escalate any mismatched totals before payroll close.</i>", styles["BodyText"]), Paragraph("<b>Allocation guide</b><br/><br/>Client onboarding: 20%<br/>Quarterly reporting: 25%<br/>Forms migration: 45%<br/>Operations: 10%<br/><br/><font color='#6a3fc1'>Cost centre: FIN-204</font>", styles["BodyText"]) ]],
            colWidths=[4.45 * inch, 4.45 * inch],
            style=TableStyle([("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#6c7f79")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 12)]),
        ),
    ])
    document.build(story, onFirstPage=decorate_page, onLaterPages=decorate_page)


def build_form(target: Path):
    pdf = canvas.Canvas(str(target), pagesize=A4, pageCompression=1)
    width, height = A4
    pdf.setTitle("Complex Employment Form")
    pdf.setFillColor(colors.HexColor("#142f2a"))
    pdf.rect(0, height - 68, width, 68, fill=1, stroke=0)
    pdf.drawImage(ImageReader(logo_bytes()), 34, height - 58, width=140, height=40, mask="auto")
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawRightString(width - 34, height - 38, "EMPLOYEE CHANGE FORM")
    pdf.setFillColor(colors.HexColor("#202d2b"))
    pdf.setFont("Helvetica", 9)
    pdf.drawString(36, height - 88, "Use this form for payroll, location and contact updates.")

    y = height - 125
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(36, y, "1. Employee details")
    y -= 28
    pdf.setFont("Helvetica", 9)
    fields = [
        ("Employee name", "Alex Morgan", "employee_name"),
        ("Employee ID", "SP-1042", "employee_id"),
        ("Department", "Finance", "department"),
        ("Work email", "alex.morgan@example.test", "work_email"),
    ]
    for label, value, name in fields:
        pdf.setFillColor(colors.HexColor("#202d2b"))
        pdf.drawString(36, y + 7, label)
        pdf.acroForm.textfield(
            name=name,
            value=value,
            x=145,
            y=y - 1,
            width=260,
            height=20,
            borderColor=colors.HexColor("#6c7f79"),
            fillColor=colors.white,
            textColor=colors.HexColor("#202d2b"),
            fontName="Helvetica",
            fontSize=9,
            forceBorder=True,
        )
        y -= 32

    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(36, y, "2. Requested changes")
    y -= 30
    options = [("Postal address", True), ("Bank details", False), ("Emergency contact", True), ("Work location", False)]
    for index, (label, checked) in enumerate(options):
        x = 36 + (index % 2) * 220
        row_y = y - (index // 2) * 30
        pdf.acroForm.checkbox(
            name=f"change_{index}",
            checked=checked,
            x=x,
            y=row_y,
            size=14,
            borderColor=colors.HexColor("#6c7f79"),
            fillColor=colors.white,
            buttonStyle="check",
        )
        pdf.setFont("Helvetica", 9)
        pdf.drawString(x + 22, row_y + 3, label)
    y -= 82
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(36, y, "Change details")
    pdf.acroForm.textfield(
        name="change_details",
        value="Move primary work location to Sydney from 1 October 2026.",
        x=36,
        y=y - 72,
        width=523,
        height=62,
        borderColor=colors.HexColor("#6c7f79"),
        fillColor=colors.white,
        fontName="Helvetica",
        fontSize=9,
        fieldFlags="multiline",
        forceBorder=True,
    )
    y -= 105
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(36, y, "3. Approval")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(36, y - 28, "Manager: Jordan Lee")
    pdf.drawString(310, y - 28, "Effective date: 1 October 2026")
    pdf.setStrokeColor(colors.HexColor("#6c7f79"))
    pdf.line(36, y - 68, 260, y - 68)
    pdf.line(310, y - 68, 559, y - 68)
    pdf.setFont("Helvetica-Oblique", 8)
    pdf.drawString(36, y - 80, "Signature")
    pdf.drawString(310, y - 80, "Date")
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(colors.HexColor("#596a66"))
    pdf.drawString(36, 24, "Simple Works · HR form · Confidential")
    pdf.drawRightString(width - 36, 24, "Page 1 of 1")
    pdf.save()


if __name__ == "__main__":
    output = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent)
    output.mkdir(parents=True, exist_ok=True)
    build_timesheet(output / "complex-timesheet.pdf")
    build_form(output / "complex-form.pdf")

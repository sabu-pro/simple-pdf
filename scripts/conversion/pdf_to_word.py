"""High-fidelity PDF to editable DOCX conversion for SimplePDF."""
from __future__ import annotations

import json
import logging
import sys
import zipfile
from pathlib import Path

DEPENDENCY_ERROR = ""
try:
    import pymupdf as fitz
    from docx import Document
    from pdf2docx import Converter
except ImportError as error:
    DEPENDENCY_ERROR = str(error)

logging.getLogger().setLevel(logging.WARNING)


def analyse_pdf(input_path: str, max_pages: int):
    document = fitz.open(input_path)
    try:
        if document.needs_pass:
            raise ValueError("Password-protected PDFs cannot be converted.")
        if document.page_count > max_pages:
            raise ValueError(f"Convert up to {max_pages} pages at a time.")
        empty_pages = []
        widget_count = 0
        image_count = 0
        for index, page in enumerate(document):
            if not page.get_text("text").strip():
                empty_pages.append(index + 1)
            widget_count += sum(1 for _ in (page.widgets() or []))
            image_count += len(page.get_images(full=True))
        return document.page_count, empty_pages, widget_count, image_count
    finally:
        document.close()


def validate_docx(output_path: str):
    with zipfile.ZipFile(output_path) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise ValueError(f"The generated Word package is corrupt near {corrupt}.")
        if "word/document.xml" not in archive.namelist():
            raise ValueError("The generated file is not an editable Word document.")
    Document(output_path)


def flatten_form_controls(input_path: str, prepared_path: str) -> int:
    """Make widget values ordinary PDF content so pdf2docx can retain them."""
    document = fitz.open(input_path)
    count = 0
    try:
        for page in document:
            widgets = list(page.widgets() or [])
            count += len(widgets)
            snapshots = [
                {
                    "type": widget.field_type,
                    "value": str(widget.field_value or ""),
                    "rect": fitz.Rect(widget.rect),
                    "font": str(widget.text_font or "Helv").lower(),
                    "size": float(widget.text_fontsize or 9),
                    "color": tuple(widget.text_color or (0, 0, 0)),
                }
                for widget in widgets
            ]
            for widget in widgets:
                page.delete_widget(widget)
            for field in snapshots:
                rect = field["rect"]
                page.draw_rect(rect, color=(0.42, 0.50, 0.48), width=0.7, overlay=True)
                if field["type"] == fitz.PDF_WIDGET_TYPE_TEXT and field["value"]:
                    fontname = field["font"] if field["font"] in {"helv", "heit", "hebo", "hebi", "cour", "tiro"} else "helv"
                    content = fitz.Rect(rect.x0 + 4, rect.y0 + 3, rect.x1 - 4, rect.y1 - 2)
                    result = page.insert_textbox(
                        content,
                        field["value"],
                        fontname=fontname,
                        fontsize=max(5, min(72, field["size"])),
                        color=field["color"],
                        lineheight=1.15,
                        overlay=True,
                    )
                    if result < 0:
                        page.insert_text(
                            (content.x0, content.y0 + max(5, min(9, field["size"]))),
                            field["value"][:500],
                            fontname="helv",
                            fontsize=max(5, min(9, field["size"])),
                            color=field["color"],
                            overlay=True,
                        )
                elif field["type"] == fitz.PDF_WIDGET_TYPE_CHECKBOX and field["value"].lower() not in {"", "off", "false", "0"}:
                    inset = max(2, rect.width * 0.18)
                    page.draw_line(
                        (rect.x0 + inset, rect.y0 + rect.height * 0.55),
                        (rect.x0 + rect.width * 0.44, rect.y1 - inset),
                        color=(0.1, 0.18, 0.16),
                        width=1.4,
                        overlay=True,
                    )
                    page.draw_line(
                        (rect.x0 + rect.width * 0.44, rect.y1 - inset),
                        (rect.x1 - inset, rect.y0 + inset),
                        color=(0.1, 0.18, 0.16),
                        width=1.4,
                        overlay=True,
                    )
        document.save(prepared_path, garbage=4, clean=True, deflate=True)
    finally:
        document.close()
    return count


def convert_pdf_to_word(input_path: str, output_path: str, max_pages: int) -> dict:
    if DEPENDENCY_ERROR:
        return {
            "ok": False,
            "code": "PYTHON_DEPENDENCIES",
            "message": DEPENDENCY_ERROR,
        }
    page_count, empty_pages, widget_count, image_count = analyse_pdf(input_path, max_pages)
    if page_count == 0:
        raise ValueError("This PDF has no pages.")
    if len(empty_pages) == page_count:
        return {
            "ok": False,
            "code": "OCR_REQUIRED",
            "message": (
                "This PDF is scanned or image-based and has no extractable text. "
                "Run OCR first, then convert the searchable PDF."
            ),
        }

    conversion_input = input_path
    prepared_path = str(Path(output_path).with_name("prepared-input.pdf"))
    if widget_count:
        flatten_form_controls(input_path, prepared_path)
        conversion_input = prepared_path
    converter = Converter(conversion_input)
    try:
        converter.convert(
            output_path,
            start=0,
            end=None,
            multi_processing=False,
        )
    finally:
        converter.close()
    validate_docx(output_path)

    warnings = []
    if empty_pages:
        warnings.append(
            f"Pages {', '.join(map(str, empty_pages))} have no extractable text and may require OCR."
        )
    if widget_count:
        warnings.append(
            "Interactive PDF form controls are converted to Word layout and may need small adjustments."
        )
    return {
        "ok": True,
        "engine": "pdf2docx",
        "emptyPages": empty_pages,
        "warnings": warnings,
        "pages": page_count,
        "widgets": widget_count,
        "images": image_count,
    }


def convert(input_path: str, output_path: str, status_path: str, max_pages: int):
    status = convert_pdf_to_word(input_path, output_path, max_pages)
    Path(status_path).write_text(json.dumps(status), encoding="utf-8")


if __name__ == "__main__":
    try:
        convert(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))
    except Exception as error:
        message = (
            str(error)
            if isinstance(error, ValueError)
            else "This PDF could not be converted. It may be damaged or use unsupported content."
        )
        Path(sys.argv[3]).write_text(
            json.dumps({"ok": False, "code": "CONVERSION_FAILED", "message": message}),
            encoding="utf-8",
        )

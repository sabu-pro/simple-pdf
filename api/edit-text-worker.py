"""Vercel Python function for source-text PDF edits."""
from __future__ import annotations

import json
import math
import sys
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Mapping
from urllib.parse import quote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.conversion.edit_pdf_text import edit_pdf_bytes

MAX_REQUEST_BYTES = 4_400_000
MAX_PDF_BYTES = 4_000_000
MAX_MANIFEST_BYTES = 300_000
MAX_EDITS = 500
MAX_TEXT_LENGTH = 2_000


class RequestError(Exception):
    def __init__(self, message: str, code: str, status: int):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def error_response(message: str, code: str, status: int):
    return status, {"Content-Type": "application/json", "Cache-Control": "no-store"}, json.dumps(
        {"error": message, "code": code}, separators=(",", ":")
    ).encode("utf-8")


def same_origin(headers: Mapping[str, str]) -> bool:
    origin = headers.get("Origin")
    if not origin:
        return True
    try:
        parsed = urlparse(origin)
        host = (headers.get("X-Forwarded-Host") or headers.get("Host", "")).split(",")[0].strip()
        protocol = (headers.get("X-Forwarded-Proto") or "https").split(",")[0].strip()
        return parsed.netloc == host and parsed.scheme == protocol
    except ValueError:
        return False


def multipart_fields(body: bytes, content_type: str) -> tuple[bytes, bytes]:
    if not content_type.lower().startswith("multipart/form-data;"):
        raise RequestError(
            "Send one PDF and its edits as a multipart upload.", "INVALID_UPLOAD", 400
        )
    message = BytesParser(policy=default).parsebytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    if not message.is_multipart():
        raise RequestError("The upload is malformed.", "INVALID_UPLOAD", 400)
    pdf: bytes | None = None
    edits: bytes | None = None
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        payload = part.get_payload(decode=True) or b""
        if name == "file" and pdf is None:
            filename = part.get_filename() or ""
            media_type = part.get_content_type()
            if not filename.lower().endswith(".pdf") or media_type not in {
                "application/pdf",
                "application/octet-stream",
            }:
                raise RequestError("Choose a valid PDF file.", "INVALID_FILE", 400)
            pdf = payload
        elif name == "edits" and edits is None:
            edits = payload
        else:
            raise RequestError(
                "Send only one PDF and one text edit manifest.", "INVALID_UPLOAD", 400
            )
    if pdf is None or not pdf:
        raise RequestError("Choose a PDF to edit.", "MISSING_FILE", 400)
    if len(pdf) > MAX_PDF_BYTES:
        raise RequestError(
            "Source-text editing on this hosted version supports PDFs up to 4 MB.",
            "FILE_TOO_LARGE",
            413,
        )
    if not pdf.startswith(b"%PDF-"):
        raise RequestError("The file is not a valid PDF.", "INVALID_FILE", 400)
    if edits is None or not edits:
        raise RequestError("No source text edits were provided.", "MISSING_EDITS", 400)
    if len(edits) > MAX_MANIFEST_BYTES:
        raise RequestError("The text edit request is too large.", "INVALID_EDITS", 413)
    return pdf, edits


def finite(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise RequestError(f"Invalid {name} in the text edit request.", "INVALID_EDITS", 400)
    return float(value)


def validate_edits(value: object) -> list[dict]:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_EDITS:
        raise RequestError(f"Send between 1 and {MAX_EDITS} text edits.", "INVALID_EDITS", 400)
    result: list[dict] = []
    identifiers: set[str] = set()
    for candidate in value:
        if not isinstance(candidate, dict):
            raise RequestError("Invalid text edit request.", "INVALID_EDITS", 400)
        identifier = candidate.get("id") if isinstance(candidate.get("id"), str) else ""
        original = candidate.get("originalText") if isinstance(candidate.get("originalText"), str) else ""
        replacement = (
            candidate.get("replacementText")
            if isinstance(candidate.get("replacementText"), str)
            else ""
        )
        if not identifier or identifier in identifiers:
            raise RequestError(
                "Each text edit must have a unique identifier.", "INVALID_EDITS", 400
            )
        identifiers.add(identifier)
        if not original.strip() or len(original) > MAX_TEXT_LENGTH:
            raise RequestError(
                "The selected source text is missing or too long.", "INVALID_EDITS", 400
            )
        if len(replacement) > MAX_TEXT_LENGTH or "\r" in replacement or "\n" in replacement:
            raise RequestError(
                "Replacement text must be a single line of up to 2,000 characters.",
                "INVALID_EDITS",
                400,
            )
        deleted = candidate.get("deleted") is True
        if not deleted and not replacement.strip():
            raise RequestError("Enter replacement text or choose Delete.", "INVALID_EDITS", 400)
        page_index = finite(candidate.get("pageIndex"), "page number")
        x = finite(candidate.get("x"), "horizontal position")
        y = finite(candidate.get("y"), "vertical position")
        width = finite(candidate.get("width"), "text width")
        height = finite(candidate.get("height"), "text height")
        if not page_index.is_integer() or not 0 <= page_index <= 9_999:
            raise RequestError("Invalid page number in the text edit request.", "INVALID_EDITS", 400)
        if x < 0 or y < 0 or width <= 0 or height <= 0 or x > 100_000 or y > 100_000:
            raise RequestError("Invalid text bounds in the text edit request.", "INVALID_EDITS", 400)
        result.append(
            {
                "id": identifier,
                "pageIndex": int(page_index),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "originalText": original,
                "replacementText": replacement,
                "deleted": deleted,
                "fontName": candidate.get("fontName", "")[:200]
                if isinstance(candidate.get("fontName"), str)
                else "",
                "fontFamily": candidate.get("fontFamily", "")[:200]
                if isinstance(candidate.get("fontFamily"), str)
                else "",
                "fontSize": finite(candidate["fontSize"], "font size")
                if candidate.get("fontSize") is not None
                else None,
                "rotation": finite(candidate["rotation"], "rotation")
                if candidate.get("rotation") is not None
                else None,
                "direction": candidate.get("direction")
                if candidate.get("direction") in {"ltr", "rtl", "ttb"}
                else "unknown",
            }
        )
    return result


def process_request(headers: Mapping[str, str], body: bytes):
    try:
        if not same_origin(headers):
            raise RequestError("Use the PDF editor on this site.", "INVALID_ORIGIN", 403)
        if len(body) > MAX_REQUEST_BYTES:
            raise RequestError("This upload is too large.", "FILE_TOO_LARGE", 413)
        pdf, manifest = multipart_fields(body, headers.get("Content-Type", ""))
        try:
            edits = validate_edits(json.loads(manifest.decode("utf-8")))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RequestError("The text edit request is invalid.", "INVALID_EDITS", 400)
        output, warnings = edit_pdf_bytes(pdf, edits)
        if len(output) > MAX_REQUEST_BYTES:
            raise RequestError("The edited PDF exceeds the hosted output limit.", "OUTPUT_TOO_LARGE", 413)
        return 200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="edited.pdf"',
            "Cache-Control": "no-store",
            "X-Edit-Warnings": quote(json.dumps(warnings, separators=(",", ":")), safe="~()*!.'-"),
        }, output
    except RequestError as error:
        return error_response(error.message, error.code, error.status)
    except ValueError as error:
        return error_response(str(error), "TEXT_EDIT_FAILED", 422)
    except Exception:
        return error_response(
            "We couldn’t apply these source text edits.", "PROCESSING_ERROR", 500
        )


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0:
            status, headers, body = error_response(
                "Choose a PDF to edit.", "MISSING_FILE", 400
            )
        elif content_length > MAX_REQUEST_BYTES:
            status, headers, body = error_response(
                "This upload is too large.", "FILE_TOO_LARGE", 413
            )
        else:
            status, headers, body = process_request(self.headers, self.rfile.read(content_length))
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        status, headers, body = error_response("Use POST to edit a PDF.", "METHOD_NOT_ALLOWED", 405)
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Allow", "POST")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

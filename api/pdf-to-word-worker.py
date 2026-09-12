"""Vercel Python function for layout-aware PDF-to-DOCX conversion."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import uuid
from contextlib import contextmanager
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Mapping
from urllib.parse import quote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.conversion.pdf_to_word import convert_pdf_to_word

MAX_REQUEST_BYTES = 4_400_000
MAX_PDF_BYTES = 4_000_000
MAX_OUTPUT_BYTES = 4_400_000
MAX_PAGES = 300


@contextmanager
def temporary_job_directory():
    if Path("/tmp").is_dir():
        with tempfile.TemporaryDirectory(prefix="simplepdf-", dir="/tmp") as directory:
            yield directory
        return
    root = Path.cwd() / ".local" / "tmp"
    root.mkdir(parents=True, exist_ok=True)
    directory = root / f"simplepdf-{uuid.uuid4().hex}"
    directory.mkdir(mode=0o755)
    try:
        yield str(directory)
    finally:
        shutil.rmtree(directory, ignore_errors=True)


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


def multipart_pdf(body: bytes, content_type: str) -> bytes:
    if not content_type.lower().startswith("multipart/form-data;"):
        raise RequestError("Send one PDF as a multipart upload.", "INVALID_UPLOAD", 400)
    message = BytesParser(policy=default).parsebytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    if not message.is_multipart():
        raise RequestError("The upload is malformed.", "INVALID_UPLOAD", 400)
    pdf: bytes | None = None
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        payload = part.get_payload(decode=True) or b""
        if name != "file" or pdf is not None:
            raise RequestError("Send only one PDF.", "INVALID_UPLOAD", 400)
        filename = part.get_filename() or ""
        media_type = part.get_content_type()
        if not filename.lower().endswith(".pdf") or media_type not in {
            "application/pdf",
            "application/octet-stream",
        }:
            raise RequestError("Choose a valid PDF file.", "INVALID_FILE", 400)
        pdf = payload
    if pdf is None or not pdf:
        raise RequestError("Choose a PDF to convert.", "MISSING_FILE", 400)
    if len(pdf) > MAX_PDF_BYTES:
        raise RequestError(
            "PDF to Word on this hosted version supports files up to 4 MB.",
            "FILE_TOO_LARGE",
            413,
        )
    if not pdf.startswith(b"%PDF-"):
        raise RequestError("The file is not a valid PDF.", "INVALID_FILE", 400)
    return pdf


def process_request(headers: Mapping[str, str], body: bytes):
    try:
        if not same_origin(headers):
            raise RequestError("Use the PDF to Word tool on this site.", "INVALID_ORIGIN", 403)
        if len(body) > MAX_REQUEST_BYTES:
            raise RequestError("This upload is too large.", "FILE_TOO_LARGE", 413)
        pdf = multipart_pdf(body, headers.get("Content-Type", ""))
        with temporary_job_directory() as directory:
            input_path = Path(directory) / "input.pdf"
            output_path = Path(directory) / "converted.docx"
            input_path.write_bytes(pdf)
            status = convert_pdf_to_word(str(input_path), str(output_path), MAX_PAGES)
            if not status.get("ok"):
                code = str(status.get("code") or "CONVERSION_FAILED")
                http_status = 503 if code == "PYTHON_DEPENDENCIES" else 422
                raise RequestError(
                    str(status.get("message") or "This PDF could not be converted."),
                    code,
                    http_status,
                )
            output = output_path.read_bytes()
        if len(output) > MAX_OUTPUT_BYTES:
            raise RequestError(
                "The converted Word document exceeds the hosted output limit.",
                "OUTPUT_TOO_LARGE",
                413,
            )
        warnings = [
            "Complex PDF layouts may require minor formatting adjustments after conversion.",
            *status.get("warnings", []),
        ]
        return 200, {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": 'attachment; filename="converted.docx"',
            "Cache-Control": "no-store",
            "X-Conversion-Warnings": quote(json.dumps(warnings, separators=(",", ":")), safe="~()*!.'-"),
        }, output
    except RequestError as error:
        return error_response(error.message, error.code, error.status)
    except ValueError as error:
        return error_response(str(error), "CONVERSION_FAILED", 422)
    except Exception:
        return error_response(
            "This PDF could not be converted. It may be damaged or use unsupported content.",
            "PROCESSING_ERROR",
            500,
        )


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0:
            status, headers, body = error_response(
                "Choose a PDF to convert.", "MISSING_FILE", 400
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
        status, headers, body = error_response(
            "Use POST to convert a PDF.", "METHOD_NOT_ALLOWED", 405
        )
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Allow", "POST")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

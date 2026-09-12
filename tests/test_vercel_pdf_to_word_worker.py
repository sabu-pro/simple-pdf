import importlib.util
import json
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "vercel_pdf_to_word_worker", ROOT / "api" / "pdf-to-word-worker.py"
)
WORKER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(WORKER)


def multipart(pdf: bytes, boundary: str) -> bytes:
    return b"".join(
        [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="file"; filename="document.pdf"\r\n',
            b"Content-Type: application/pdf\r\n\r\n",
            pdf,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )


def headers(boundary: str) -> dict[str, str]:
    return {
        "Origin": "https://simple-pdf-green.vercel.app",
        "Host": "simple-pdf-green.vercel.app",
        "X-Forwarded-Proto": "https",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }


class VercelPdfToWordWorkerTest(unittest.TestCase):
    def test_converts_a_complex_text_pdf_to_an_editable_docx(self):
        source = (ROOT / "tests" / "fixtures" / "complex-timesheet.pdf").read_bytes()
        boundary = "simplepdf-pdf-to-word"
        status, response_headers, output = WORKER.process_request(
            headers(boundary), multipart(source, boundary)
        )
        self.assertEqual(status, 200)
        self.assertIn("wordprocessingml.document", response_headers["Content-Type"])
        with zipfile.ZipFile(BytesIO(output)) as archive:
            names = archive.namelist()
            document_xml = archive.read("word/document.xml").decode("utf-8")
        self.assertIn("Alex Morgan", document_xml)
        self.assertIn("Quarterly reporting", document_xml)
        self.assertIn("<w:tbl", document_xml)
        self.assertIn("<w:b", document_xml)
        self.assertGreaterEqual(document_xml.count("<w:sectPr"), 2)
        self.assertTrue(any(name.startswith("word/media/") for name in names))

    def test_returns_an_ocr_message_for_an_image_only_pdf(self):
        temp_root = ROOT / ".local" / "tmp"
        before = {path.name for path in temp_root.glob("simplepdf-*")} if temp_root.exists() else set()
        document = pymupdf.open()
        page = document.new_page()
        page.draw_rect((40, 40, 400, 300), fill=(0.8, 0.8, 0.8))
        source = document.tobytes()
        document.close()
        boundary = "simplepdf-image-only"
        status, _, output = WORKER.process_request(
            headers(boundary), multipart(source, boundary)
        )
        payload = json.loads(output)
        self.assertEqual(status, 422)
        self.assertEqual(payload["code"], "OCR_REQUIRED")
        self.assertIn("OCR", payload["error"])
        after = {path.name for path in temp_root.glob("simplepdf-*")} if temp_root.exists() else set()
        self.assertEqual(after, before)

    def test_enforces_the_300_page_limit(self):
        document = pymupdf.open()
        for _ in range(301):
            page = document.new_page(width=100, height=100)
            page.insert_text((8, 20), "text", fontsize=6)
        source = document.tobytes(deflate=True)
        document.close()
        boundary = "simplepdf-page-limit"
        status, _, output = WORKER.process_request(
            headers(boundary), multipart(source, boundary)
        )
        payload = json.loads(output)
        self.assertEqual(status, 422)
        self.assertIn("300 pages", payload["error"])


if __name__ == "__main__":
    unittest.main()

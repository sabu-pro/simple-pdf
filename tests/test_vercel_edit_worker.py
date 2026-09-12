import importlib.util
import json
import unittest
from pathlib import Path

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "vercel_edit_worker", ROOT / "api" / "edit-text-worker.py"
)
WORKER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(WORKER)


def multipart(pdf: bytes, edits: list[dict], boundary: str) -> bytes:
    return b"".join(
        [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="file"; filename="timesheet.pdf"\r\n',
            b"Content-Type: application/pdf\r\n\r\n",
            pdf,
            b"\r\n",
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="edits"\r\n\r\n',
            json.dumps(edits).encode(),
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )


class VercelEditWorkerTest(unittest.TestCase):
    def test_replaces_original_text_and_returns_a_pdf(self):
        source = (ROOT / "tests" / "fixtures" / "complex-timesheet.pdf").read_bytes()
        document = pymupdf.open(stream=source, filetype="pdf")
        rect = document[0].search_for("Approved")[0]
        document.close()
        edits = [
            {
                "id": "source-1-test",
                "pageIndex": 0,
                "x": rect.x0,
                "y": rect.y0,
                "width": rect.width,
                "height": rect.height,
                "originalText": "Approved",
                "replacementText": "Cleared",
                "deleted": False,
                "fontSize": 10,
                "rotation": 0,
                "direction": "ltr",
            }
        ]
        boundary = "simplepdf-test-boundary"
        status, headers, output = WORKER.process_request(
            {
                "Origin": "https://simple-pdf-green.vercel.app",
                "Host": "simple-pdf-green.vercel.app",
                "X-Forwarded-Proto": "https",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            multipart(source, edits, boundary),
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/pdf")
        edited = pymupdf.open(stream=output, filetype="pdf")
        text = "\n".join(page.get_text() for page in edited)
        edited.close()
        self.assertIn("Cleared", text)
        self.assertNotIn("Approved", text)


if __name__ == "__main__":
    unittest.main()

import importlib.util
import io
import json
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "vercel_edit_worker", ROOT / "api" / "edit-text-worker.py"
)
WORKER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(WORKER)
from scripts.conversion import edit_pdf_text as EDIT_TEXT


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

    def test_replaces_bundled_underscore_blank_at_its_own_position(self):
        document = pymupdf.open()
        page = document.new_page(width=612, height=792)
        page.insert_text((60, 100), "Full Name:", fontname="helv", fontsize=12)
        label_before = page.search_for("Full Name:")[0]
        page.insert_text(
            (label_before.x1 - 2, 100),
            "__________",
            fontname="helv",
            fontsize=12,
        )
        source = document.tobytes()
        document.close()

        original = pymupdf.open(stream=source, filetype="pdf")
        source_page = original[0]
        self.assertIn("Full Name:__________", source_page.get_text().replace("\n", ""))
        blank_before = source_page.search_for("__________")[0]
        original.close()

        edits = [
            {
                "id": "source-1-underscore",
                "pageIndex": 0,
                "x": blank_before.x0,
                "y": blank_before.y0,
                "width": blank_before.width,
                "height": blank_before.height,
                "originalText": "__________",
                "replacementText": "____Sample User________",
                "deleted": False,
                "fontSize": 12,
                "rotation": 0,
                "direction": "ltr",
            }
        ]
        boundary = "simplepdf-underscore-boundary"
        diagnostics = io.StringIO()
        with patch.object(EDIT_TEXT, "_DEBUG_TEXT_EDIT", True), redirect_stderr(diagnostics):
            status, _, output = WORKER.process_request(
                {
                    "Origin": "https://simple-pdf-green.vercel.app",
                    "Host": "simple-pdf-green.vercel.app",
                    "X-Forwarded-Proto": "https",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                },
                multipart(source, edits, boundary),
            )

        self.assertEqual(status, 200)
        diagnostic = json.loads(diagnostics.getvalue().strip())
        self.assertEqual(diagnostic["originalText"], "__________")
        self.assertEqual(diagnostic["replacementText"], "Sample User")
        self.assertEqual(diagnostic["verificationText"], "Sample User")
        self.assertEqual(len(diagnostic["selectedBounds"]), 4)

        edited = pymupdf.open(stream=output, filetype="pdf")
        output_page = edited[0]
        self.assertIn("Full Name:", output_page.get_text())
        self.assertFalse(output_page.search_for("__________"))
        replacement = output_page.search_for("Sample User")[0]
        label_after = output_page.search_for("Full Name:")[0]
        self.assertAlmostEqual(replacement.x0, blank_before.x0, delta=0.1)
        self.assertAlmostEqual(label_after.x0, label_before.x0, delta=0.1)
        self.assertAlmostEqual(label_after.x1, label_before.x1, delta=0.1)
        edited.close()

    def test_warns_only_after_an_unextractable_replacement_visibly_renders(self):
        document = pymupdf.open()
        page = document.new_page(width=300, height=180)
        page.insert_text((50, 90), "Original", fontname="helv", fontsize=12)
        rect = page.search_for("Original")[0]
        source = document.tobytes()
        document.close()
        edits = [
            {
                "id": "source-1-visual-fallback",
                "pageIndex": 0,
                "x": rect.x0,
                "y": rect.y0,
                "width": rect.width,
                "height": rect.height,
                "originalText": "Original",
                "replacementText": "Updated",
                "deleted": False,
                "fontSize": 12,
                "rotation": 0,
                "direction": "ltr",
            }
        ]

        with patch.object(EDIT_TEXT, "verification_text", return_value=""):
            output, warnings = EDIT_TEXT.edit_pdf_bytes(source, edits)
        self.assertTrue(any("was rendered" in warning for warning in warnings))
        edited = pymupdf.open(stream=output, filetype="pdf")
        self.assertTrue(edited[0].search_for("Updated"))
        edited.close()

        with (
            patch.object(EDIT_TEXT, "verification_text", return_value=""),
            patch.object(EDIT_TEXT, "rendered_replacement_changed", return_value=False),
        ):
            with self.assertRaisesRegex(ValueError, "could not be verified"):
                EDIT_TEXT.edit_pdf_bytes(source, edits)


if __name__ == "__main__":
    unittest.main()

# Local verification

Verified on 12 September 2026 in the PDFEDITINGSOFTWARE workspace, using Windows, Node.js 25.9.0, npm 11.12.1, Next.js 16.3.5, Python 3.14, PyMuPDF 1.28.2, pdf2docx 0.5.13, and local Chromium 153.

| Check                                | Result                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| `npm run lint`                       | Passed, no warnings or errors                             |
| `npm run typecheck`                  | Passed                                                    |
| `npx prettier --check .`             | Passed                                                    |
| Python compilation                   | Passed for both workers and the complex-fixture generator |
| `npm test`                           | 39 tests passed across 3 suites                           |
| `npm run test:e2e`                   | 7 Chromium workflows passed against localhost             |
| `npm run build`                      | Passed; five tool pages and three API routes built        |
| Development preview                  | HTTP 200 at http://localhost:3000                         |
| `/api/capabilities`                  | PDF-to-Word available; Word-to-PDF unavailable without LO |
| Dependency audit during installation | 0 reported npm vulnerabilities                            |

The original-text workflow was tested end to end against a two-page landscape timesheet. The test selected existing PDF.js text runs, replaced “Approved” with “Cleared,” deleted “Finance,” downloaded the result, and re-extracted its text. PyMuPDF inspection confirmed that the replacement retained the same embedded Helvetica Bold font, 10 pt size, green colour, origin, and bounding-line height. A rendered before/after review confirmed that the adjacent “Department” line, table rules, image, and other page content stayed intact and that no white cover rectangle was introduced. A separate regression replaced text on a cropped page rotated by 90 degrees, then verified the old text was absent and the page rotation remained intact.

PDF-to-Word was tested against a two-page timesheet containing a raster logo, tables, two-column content, different font sizes, bold/italic/coloured text, repeated headers/footers, and page sections. A separate A4 form contained nine AcroForm controls, checked and unchecked boxes, multiline content, and signature lines. The generated DOCX packages were reopened and checked for editable XML text, Word tables, styles, sections, embedded media, page text, and flattened form values. LibreOffice is absent on this machine, so an automated rendered DOCX-to-PDF pixel comparison was not possible; the package structure and source/converted layout objects were inspected instead.

Regression coverage also verified homepage/mobile navigation, PDF rendering and zoom, added text editing/movement/resizing, undo/redo, highlights, drawing, all three signature methods, cropped/rotated page export, merge order, scan errors, bounded uploads, temporary cleanup, and dependency capability messages.

LibreOffice and Docker are not installed on this machine. The missing-LibreOffice setup message and `503 LIBREOFFICE_UNAVAILABLE` path were verified. A successful LibreOffice DOCX-to-PDF conversion and the container image still need verification on a host with those tools. PDF-to-Word and original-text editing are available locally through the installed Python dependencies.

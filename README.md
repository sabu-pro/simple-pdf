# SimplePDF

PDF editing without the headache. A local-first, free web application for **Edit PDF, Merge PDF, Word to PDF, PDF to Word, and Sign PDF**.

No AI, paid processing APIs, accounts, database, cloud storage, payments, or tracking. Viewing, additions, merging, signing, and Word-to-PDF conversion run in your browser. Original-text edits and PDF-to-Word conversion use temporary Python jobs.

## Run locally

Requirements: **Node.js 22.13+** (Node 24 LTS recommended), npm, and Git. Python 3.11+ with the conversion dependencies is required for local original-text editing and PDF-to-Word conversion. Word-to-PDF does not require LibreOffice.

```powershell
cd C:\Users\sabut\Downloads\PDFEDITINGSOFTWARE
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:3000**. Next.js updates the preview as you edit source files. If `.env.local` already exists, keep it instead of copying over it. No secrets are needed.

The first installation downloads dependencies. After that, browser assets, the PDF worker, and common Word-conversion fonts are served locally; no conversion API is used. `npm ci` copies PDF.js assets and the open metric-compatible Word-conversion fonts into `public/` through the postinstall script.

For source-text editing and layout-aware PDF-to-Word conversion, install the free/open-source Python engine:

```powershell
python -m pip install -r requirements-conversion.txt
```

This uses PyMuPDF, pdf2docx, and python-docx. Set `PYTHON_PATH` in `.env.local` when Python is not on the normal `python` command path. Scanned PDFs need OCR before source-text editing or conversion; SimplePDF detects and explains that boundary rather than returning a low-quality text dump.

## The five tools

| Tool        | What works                                                                                                                                  | Where processing happens                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Edit PDF    | Select/replace/delete original text; add/move/resize text, drawings, highlights and signatures; undo/redo; export                           | Browser plus isolated PyMuPDF worker for source text |
| Merge PDF   | Multiple uploads, page counts, drag or button reordering, removal, real page copying, download                                              | Browser memory                                       |
| Word to PDF | DOCX → PDF with supported styles, tables, images, sections, headers/footers and page breaks through Ream                                   | Browser memory                                       |
| PDF to Word | Layout-aware editable DOCX with text styling, page dimensions, tables, images, columns, visual headers/footers, form values and page breaks | Temporary pdf2docx Python job                        |
| Sign PDF    | Draw, type, or upload PNG/JPG; move/resize; embed into a new PDF                                                                            | Browser memory                                       |

## Word-to-PDF engine

Word-to-PDF uses the MIT-licensed Ream OOXML/PDF engine in the browser, so it works on Vercel without LibreOffice or an uploaded document. Embedded DOCX fonts are used when available. Arimo, Tinos, Cousine, Carlito and Caladea are bundled as open metric-compatible substitutes for common fonts such as Arial, Times New Roman, Courier New, Calibri and Cambria. Complex or unsupported Word features can still differ and should be reviewed before sharing.

## Commands

```bash
npm run dev          # Local preview, bound to 127.0.0.1:3000
npm run lint         # ESLint
npm run typecheck    # TypeScript, without emitting files
npm test            # Unit and integration tests, including real PDF/DOCX output
npm run test:vercel-worker # Vercel Python text-edit and PDF-to-Word endpoints
npm run test:watch   # Interactive unit test runner
npm run test:e2e     # Chromium workflows; reuses a running local dev server
npm run build       # Production build
npm start           # Production server on port 3000
```

Browser tests use a project-local Chromium installation. Install it once:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.local\browsers"
npx playwright install chromium
npm run test:e2e
```

On Linux/macOS:

```bash
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/browsers" npx playwright install chromium
npm run test:e2e
```

Synthetic sample files are generated in `.local/fixtures/` by the browser suite. These include a regular/cropped/rotated PDF and a Word document. Browser screenshots are saved in `.local/screenshots/`. Those folders, test traces, and dependencies are excluded from Git. Do not use real private documents as test fixtures or enable request-body logging.

The synthetic complex fixtures in `tests/fixtures/` are committed so conversion tests do not need extra test-time packages. To regenerate them, install the open-source ReportLab package and run `python tests/fixtures/generate_complex_pdfs.py tests/fixtures`.

## Configuration

Copy `.env.example` to `.env.local` for local development. Production variables can be provided by the host.

| Variable                    | Default        | Purpose                                                                                      |
| --------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_MAX_UPLOAD_MB` | `50`           | Browser per-file limit; changing it requires restarting development or rebuilding production |
| `MAX_UPLOAD_MB`             | `50`           | Server per-file limit, 1–100 MB; enforced on the stream                                      |
| `CONVERSION_TIMEOUT_MS`     | `90000`        | Worker/LibreOffice timeout, 1,000–180,000 ms                                                 |
| `MAX_PDF_PAGES`             | `300`          | PDF-to-Word page limit, 1–1,000                                                              |
| `TEMP_DIRECTORY`            | OS temp folder | Private temporary processing location, outside public/static paths                           |

Merge is also limited to 30 documents, 2,000 pages, and a combined size of three times the browser per-file limit. Signature images are limited to 5 MB and 20 megapixels. PDF-to-Word extraction is bounded to two million text characters and a 512 MB Node heap. Two server conversions can run concurrently per process; excess requests receive HTTP 429.

## Architecture

```text
src/app/                     App Router pages, layout and error screens
src/app/api/capabilities/     Dependency availability and limits
src/app/api/convert/          Bounded upload + conversion response
src/app/api/edit-text/        Bounded original-text edit response
src/components/editor/       PDF viewer, SVG overlays, properties and signature dialog
src/components/              Upload, merge, conversion and shared UI
src/types/editor.ts          Document, page geometry and discriminated object model
src/lib/editor/              Coordinates, serialization validation, undo/redo
src/lib/pdf/                 PDF.js text model, pdf-lib validation/merge/export, source-edit client
src/lib/files/               Validation, streaming upload, downloads, temporary lifecycle
src/lib/conversion/          Service interface, LibreOffice, ZIP validation, subprocess control
scripts/conversion/          Isolated PyMuPDF source editing and pdf2docx conversion
tests/                       Unit, integration and browser tests
```

### Editor and viewer

PDF.js renders only the active page into a canvas. Rendering is cancelled when switching pages or zooming. Device pixel ratio and render pixel count are bounded. No thumbnails or full-document render pass are needed to view a large PDF.

The original PDF bytes remain immutable during the editing session. User additions are typed `EditorObject` records: `text`, `draw`, `highlight`, and `signature`. Source edits are separate `SourceTextEdit` records that identify a PDF.js text run and its rotation-aware bounds. Both kinds share the same 50-step undo/redo history. A signature is a PNG/JPG image; typed/drawn signatures are rasterized into transparent PNGs. The fonts used for the UI and the default handwritten style are bundled from Fontsource with their license files in their packages.

Coordinates use the displayed page at **scale 1, origin top left**. PDF.js supplies the viewport transform, including the source page’s crop box and rotation. Pointer coordinates are converted from the actual SVG bounds into that display space. Zoom changes only rendering, never stored object coordinates.

For original text, PDF.js exposes one selectable run at a time. Export sends only the PDF and bounded edit manifest to a private temporary job. PyMuPDF matches the selected run by text and position, applies a fill-free redaction band that removes the source character content, and then inserts the replacement on the original baseline with the source font resource, size, colour, orientation, and inferred alignment. It shrinks long replacements only when necessary to fit and reports a substitute-font warning when an embedded font lacks the requested glyphs.

After source edits, pdf-lib uses the inverse viewport transform, composed with a vertical flip, to place added objects into the original page coordinate system. This preserves rotation and crop boxes. Text remains PDF text; drawings, highlights, and images are embedded into the page content stream. Pages are never flattened to screenshots.

Undo/redo uses immutable snapshots, capped at 50 changes. Dragging commits once when the pointer is released. Keyboard shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Delete/Backspace, arrow-key movement, and Shift+arrow movement. Text inputs keep their normal native editing shortcuts. Added objects are keyboard-focusable; the properties panel provides keyboard text editing, width, font size and deletion. Refreshing or leaving the editor discards its in-memory session; the browser warns on refresh/close when there are additions.

### Conversion boundaries

Word → PDF uses Ream in the browser with bundled open fonts. PDF → Word uses the open-source pdf2docx worker; it does not silently fall back to a paragraph-only converter.

PDF → Word uses three explicit stages:

1. `pdf_to_word.py` preflights page count, encryption, extractable text, images, and AcroForm widgets with PyMuPDF. Form values are flattened into ordinary content in a private temporary copy so the values remain editable in Word.
2. pdf2docx reconstructs the DOCX from positioned text and styling, tables, columns, images, page dimensions, spacing, and page sections. The output ZIP and Word document structure are reopened before download.
3. The status file identifies textless pages. Fully textless PDFs fail with `OCR_REQUIRED` and explain that OCR must be run first.

On a local Node server, the PDF parser and DOCX generator run in a separate process with a time limit. On Vercel, the same conversion function runs inside the isolated Python Function. Errors returned to the browser are controlled messages, without local paths or stack traces.

### File lifecycle and security

Conversion requests stream through Busboy and an independent total-byte limiter. File extensions, MIME types (including a fallback for absent/generic browser MIME), size, and magic bytes are checked. DOCX ZIP structure is inspected with entry count, expanded size and compression ratio limits. User filenames are never used for filesystem paths. Nothing is extracted into a user-controlled path or served as executable content.

Each request gets a random `simplepdf-*` private temporary directory outside `public/`. Uploaded files use restrictive creation modes. Completion and failure both run cleanup in `finally`, before the response is returned. Client downloads are in-memory Blobs. There is no database or permanent storage path.

An abrupt operating-system termination can prevent `finally` from running. For deployed servers, use a private ephemeral temp volume, clean it when starting the container, and apply your host’s temp retention policy. Do not describe this as forensic erasure. Uploaded documents may contain sensitive information: keep TLS at the ingress and disable body logging.

## Production and deployment

On Vercel, original-text editing and PDF-to-Word use file-based Python Functions. `requirements.txt` makes Vercel install PyMuPDF, pdf2docx and python-docx automatically. Jobs write only to `/tmp` and delete their temporary directory on success or failure. The 300-page limit remains enforced. Because Vercel limits function request and response bodies to 4.5 MB, hosted source-text editing and PDF-to-Word accept PDFs up to 4 MB, and PDF-to-Word reports when its generated DOCX exceeds the response limit.

Word-to-PDF, merge, added text, drawings, highlights and signatures run in browser memory. The Word converter therefore has no Vercel binary, temporary-file or function-body dependency.

A Dockerfile and Compose configuration are included:

```bash
docker compose up --build
```

Open http://localhost:3000. The runtime runs as a non-root user, with a read-only root filesystem, a bounded tmpfs for temporary files, dropped capabilities, an internal-only network, and process/memory limits. The runtime includes LibreOffice and open-source fonts. Docker was not available on the development machine, so validate this deployment on your Docker host before relying on it.

Before exposing the service publicly, add a reverse proxy with TLS, body-size limits, timeouts and rate limiting. The built-in two-job limit is per process, not a distributed queue. Reject cross-origin form uploads. Run document processing without outbound network access; application validation alone is not a substitute for OS isolation against malformed third-party files. Keep the office and PDF engines patched. For higher traffic, isolate conversion into dedicated workers with an admission queue and request quotas.

## Known limitations

- Original-text editing supports selectable PDF text runs. A scanned/image-only page needs OCR first. Replacements are single-line, and unusually long text may be reduced to fit; an embedded font without the requested glyphs uses a close standard-font substitute with a warning.
- Added text uses Helvetica-compatible PDF standard fonts and supports their Latin character repertoire. Unsupported characters produce an explicit export error. Signatures can contain any characters your system can draw into the image.
- Text boxes use explicit line breaks. There is no Word-style automatic paragraph reflow. Resize text with its corner handle or font size.
- PDF-to-Word reconstructs layout from drawing coordinates because PDF has no Word-style document model. Dense forms, unusual fonts, more than two columns, and overlapping objects can still need manual adjustment. Repeated headers and footers are kept visually but may remain positioned page content rather than semantic Word header/footer fields.
- Password-protected PDFs and Word files are not supported. AcroForm values are converted to editable Word content rather than interactive Word controls. Source annotations and document-level metadata are not editable.
- Signatures are visible images, not cryptographically certified digital signatures. Editing or merging a previously certified PDF can invalidate its certificate.
- Merge copies pages and visible content; bookmarks, outlines, cross-document links and digital signature certificates are not guaranteed to survive.
- Undo/redo and editable sessions live only in memory. Downloaded overlays become part of the exported PDF, and are not restored as editable objects on re-upload.
- Very large/complex PDFs can strain browser memory even within the upload size limit. Rendering is lazy, but parsing and export still use in-memory buffers.
- Word-to-PDF supports the WordprocessingML features implemented by Ream. Fonts not embedded in the DOCX use bundled open metric-compatible substitutes, and uncommon writing systems may require a font download. Fields, macros, embedded programs and unusual drawing effects may change or be omitted.

## Testing

Unit/integration tests cover file/MIME/magic/size validation, malformed PDFs, real merge order, overlay serialization, zoom and rotated/cropped coordinate conversion, PDF.js source bounds, true glyph removal, style-matched replacement, adjacent-line safety, signature embedding, undo/redo, temporary cleanup, streaming upload limits, genuine DOCX structure, missing LibreOffice, process timeouts, OCR detection, mixed pages, and complex timesheet/form conversion.

Browser tests open actual PDFs, replace and delete original text, draw/highlight/type/sign, resize and move additions, navigate rotated pages, download and re-extract real PDFs, reorder and merge files, convert a complex timesheet to Word, check scan errors, and inspect the server’s real Word conversion capability. Synthetic fixtures cover a two-page timesheet with tables, columns, styles, images, headers/footers and a form with nine interactive controls.

## Git and next steps

This folder is its own Git repository on `main`; it is independent of any parent repository. Dependencies, local environment files, generated assets, temporary samples, and document outputs are ignored. No remote has been configured.

Recommended next work is open-source OCR behind the existing extraction boundary, semantic Word header/footer recognition, saved sessions, stronger worker isolation, and deployment testing.

## Technical references

- [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation)
- [PDF.js viewport and rendering examples](https://mozilla.github.io/pdf.js/examples/)
- [pdf-lib documentation](https://pdf-lib.js.org/docs/)
- [PyMuPDF documentation](https://pymupdf.readthedocs.io/)
- [pdf2docx documentation](https://pdf2docx.readthedocs.io/)
- [Ream document converter](https://github.com/alex-krassavin/reamkit)
- [DOCX library](https://docx.js.org/)

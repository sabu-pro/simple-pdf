# Implementation plan

The workspace was empty on inspection. Build SimplePDF as a Next.js App Router application, with no accounts, database, paid services, or AI.

1. Initialize an isolated Git repository, Next.js, TypeScript, Tailwind, a shared accessible UI, and the five tool routes. Run the application.
2. Implement PDF.js viewing, a lazy text-run model, and typed editor records. Keep coordinates in the rotated page's display space at scale 1, retaining the viewport transform for accurate export into cropped/rotated PDFs. Use a PyMuPDF worker for fill-free source glyph removal and style-matched replacement. Share undo/redo across source edits, text, drawing, highlights, and signatures.
3. Implement browser-side merge with validation and document ordering. Test actual page content and order.
4. Implement bounded streaming uploads and temporary server-side conversion: LibreOffice DOCX to PDF, PyMuPDF source-text editing, and pdf2docx layout reconstruction for PDF to Word. Flatten form values in a temporary PDF copy, validate the resulting DOCX package, and surface the OCR boundary honestly.
5. Complete signature input methods, responsive UI, accessibility, error states, and setup documentation.
6. Run unit/integration tests, browser workflows, lint, type checking, and a production build. Inspect the resulting UI and generated documents. Commit the completed MVP.

Browser tools keep files in memory. Conversion jobs use private temporary directories and delete them after success or failure. A Node server/container is required for LibreOffice and isolated conversion workers.

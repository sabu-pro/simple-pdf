# AcroForm finalization for Edit downloads

The editor in this checkout does not set AcroForm `/V` values. It imports filled
widgets from the uploaded PDF. Previously, `Editor.download()` passed those
widgets through the shared overlay exporter unchanged.

Edit now calls `exportEditedPdf()` after source-text edits. It finalizes the
source form through `flattenAcroForm()` before calling the existing overlay
exporter. Sign still calls `exportPdf()` directly. Merge and Convert are unchanged.

## Appearance handling

- Existing normal appearances retain their original fonts, colors, graphics,
  borders, and layout.
- Missing text/choice appearances, and text/choice fields marked with
  `/NeedAppearances`, are explicitly regenerated with PDF.js. It resolves the
  inherited `/DA`, `/DR`, and appearance font resources, including embedded fonts
  and their character encodings. No blanket Helvetica regeneration is applied.
- If the original font cannot encode the value, the download fails with an
  actionable error instead of flattening missing text.
- Appearance streams become page XObjects, fitted using their `/BBox`, `/Matrix`,
  and widget `/Rect`. All page widget references and the catalog's `/AcroForm`
  entry are removed, including repeated and orphan widgets. Other annotations
  remain in place. Hidden widgets stay hidden.
- Documents without widgets pass through finalization byte-for-byte. Existing
  overlay drawing code is unchanged.

## Validation

`npm test` covers real text fields, multiline fields, checkboxes, radio buttons,
repeated widgets, missing/stale appearances, inherited styling, embedded fonts,
hidden fields, orphan widgets, crop/rotation, unrelated links, and unchanged
flat/scanned overlays and shared Sign exports. The nine-field employment form
renders pixel-for-pixel identically before and after flattening. Tests render the
output with annotations disabled and reopen it to require zero widgets and no
AcroForm tree.

`npx playwright test tests/e2e/acroform.spec.ts` checks actual downloads and
reopening exported values as ordinary page text. The download tests passed in
Chromium, installed Chrome, and WebKit on Windows. The employment form and
embedded-font sample were visually inspected in Chrome's built-in PDF viewer,
PDF.js, and MuPDF.

Acrobat could not be inspected because the native desktop-control connection was
unavailable. macOS/iOS Preview was unavailable; WebKit testing is not a Preview
or physical iOS test. The user's original failing PDF was not provided, so
verification used the repository's real AcroForm and a reproducible embedded-font
fixture (`tests/fixtures/generate_embedded_form.py`).

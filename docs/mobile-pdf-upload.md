# Mobile PDF upload compatibility

Status: the follow-up Edit/Sign renderer fix is implemented and checked in automated browsers; real-device confirmation is still required.

## Findings

The original browser loader imported `pdfjs-dist` 6.3.289's modern display bundle and always selected `/pdfjs/pdf.worker.min.mjs`. There was no capability check. PDF.js's modern worker calls newer built-ins, including `Uint8Array.prototype.toHex` when computing document fingerprints. Its display bundle also references `Iterator` during module initialization.

A pre-change diagnostic run in Chromium removed `toHex` separately from the page and worker globals. Selecting a valid PDF produced `n.toHex is not a function`, with no document loaded. The worker response was HTTP 200 with `application/javascript; charset=UTF-8`. The unmodified control loaded the same PDF. This establishes a reproducible compatibility failure, but does **not** establish the exact missing API on the reported iPhone: neither its iOS version nor its remote-inspector stack was available.

The first compatibility patch selected PDF.js 6's `legacy` build when those APIs were missing. That fixed byte-processing tools but did not fix Edit/Sign on the reported phone. Mozilla's current [browser-support FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsers-are-supported) lists Safari 18+ for the current legacy build. [PDF.js issue #20899](https://github.com/mozilla/pdf.js/issues/20899) independently reproduces the rendering failure on iOS 17: 5.4.54 works with the `Promise.withResolvers` shim, while 5.5+ contains newer worker syntax that iOS 17 cannot parse. Syntax support cannot be added with a runtime polyfill. Page polyfills also do not populate worker globals.

The original `errorMessage` returned arbitrary `Error.message` strings, overriding every friendly fallback. That explains why the raw exception appeared in the screenshot despite an upload `try/catch` already existing.

## Changes

- Detect the modern PDF.js runtime capabilities before importing either bundle. Capable desktop browsers retain PDF.js 6 and its existing worker URL. Feature-limited browsers use a separately pinned `pdfjs-dist` 5.4.54 display bundle and same-origin worker only in the Edit/Sign rendering path.
- Supply `Promise.withResolvers` only when absent, in both the compatibility page path and worker. Use native `Blob.arrayBuffer` when available and `FileReader` otherwise.
- Bundle the compatibility renderer's matching CMaps, standard fonts, and WASM assets. Disable OffscreenCanvas, ImageDecoder, and worker-side asset fetching in compatibility mode to avoid partial mobile WebKit implementations.
- Calculate text-layer transforms locally instead of importing PDF.js 6 again after the compatibility document has loaded.
- Log the precise failing Edit/Sign stage and the original exception in the browser console: file read, validation, PDF.js document load, first-page text extraction, viewport setup, or canvas render.
- Destroy failed PDF loading tasks and documents that fail before the editor accepts them.
- Display explicitly authored validation errors and friendly fallbacks for unexpected errors. Preserve original exception objects in the browser console for debugging. Apply this to Edit, Sign, Merge, Word-to-PDF, PDF-to-Word, and page rendering.
- Catch synchronous XHR setup/send failures and asynchronous conversion callbacks. Map server error codes to authored messages instead of echoing arbitrary server exception strings. Retain the shared route error boundary.

## Automated verification

Verified locally: 49 unit tests passed; 29 Chromium/WebKit compatibility checks passed (the desktop-only worker assertion is skipped in WebKit); and all 8 existing desktop workflows passed. The compatibility set includes the complex-form Sign test in both engines. TypeScript, ESLint, formatting, and the production build passed.

`npm run test:browser-compatibility` runs Chromium and Playwright WebKit on Windows. It covers missing `Iterator`, `toHex`, map helpers, and `Promise.withResolvers` independently in the page and worker; requests the pinned mobile worker; renders actual page pixels; adds and exports text; opens a complex form in Sign PDF; places and exports a signature; checks file-reader fallback; and checks worker failure recovery. A Chromium check asserts that capable desktop browsers still request the original modern worker.

The existing desktop workflow suite covers original text edits, annotations, form marks, signatures, merging, both conversions, downloads, and scan guidance. During concurrent tests, the PDF-to-Word capability probe timed out; rerunning that workflow independently passed. Compatibility tests use a separate output directory to avoid trace-file collisions with the desktop suite.

These are automated desktop browser-engine tests, including a mobile viewport. They are **not real iOS Safari or Android Chrome results**.

## Required real-device verification

Before closing the bug, connect the reported iPhone to Safari Web Inspector on a Mac and an Android device to Chrome remote debugging, or provide an equivalent real-device service. Record device/OS/browser versions and the tested deployment revision.

1. On the original version, reproduce first-file selection with the failing PDF and save the complete exception stack, worker requests/status/MIME, and console output.
2. On the fixed revision, open the same PDF from the device picker; verify visible pages, text editing or annotations, and download. Reopen the downloaded file and verify its original content and edits.
3. Check Sign, Merge, Word-to-PDF, and PDF-to-Word, including downloads. Try an invalid file and then retry with a valid file.

The changes in this workspace do not update the deployed site by themselves.

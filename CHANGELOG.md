# Changelog

## 0.1.1 — 2026-09-17

- Simplify generated HTML and SVG reports so the most useful reproduction evidence is easier to scan.
- Add regression coverage for the compact report output and keep the committed demo artifacts in sync.
- Publish through npm Trusted Publishing without a long-lived npm token.

## 0.1.0 — 2026-09-13

- Capture command output, argv, exit status and bounded reproducibility metadata.
- Redact detected secrets before writing local bundles.
- Generate static HTML, Markdown, an SVG evidence card and reproduction helpers.
- Print a ready-to-paste issue body from the latest completed local capture.
- Add versioned manifest and deterministic evidence scoring.
- Preserve literal arguments across Windows `.cmd`/`.bat` capture and PowerShell replay, and reject unsafe batch arguments containing line breaks.
- Preserve UTF-8 boundaries in report previews and prevent multiline metadata from changing Markdown structure.

# Changelog

## 0.1.0 — Unreleased

- Capture command output, argv, exit status and bounded reproducibility metadata.
- Redact detected secrets before writing local bundles.
- Generate static HTML, Markdown, an SVG evidence card and reproduction helpers.
- Print a ready-to-paste issue body from the latest completed local capture.
- Add versioned manifest and deterministic evidence scoring.
- Preserve literal arguments across Windows `.cmd`/`.bat` capture and PowerShell replay, and reject unsafe batch arguments containing line breaks.
- Preserve UTF-8 boundaries in report previews and prevent multiline metadata from changing Markdown structure.

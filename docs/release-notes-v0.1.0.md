# ReproShot v0.1.0

The first public release of ReproShot turns a failing local command into a reviewable bug-report bundle.

## Highlights

- Run commands directly while preserving argv and exit status across Windows, Linux and macOS.
- Save bounded, redacted stdout/stderr together with Git and runtime metadata.
- Generate Markdown, static HTML, an SVG evidence card, a versioned JSON manifest, checksums and reviewed-command helpers.
- Generate a ready-to-paste GitHub issue body with `reproshot issue`.
- Exclude sensitive, ignored, binary, symlinked and oversized Git changes from collected patches.
- Report evidence completeness with a deterministic Repro Score.

## Compatibility

Node.js 20, 22 and 24 are covered on Windows, Ubuntu and macOS. The package contains no telemetry, account system or hosted service.

## Security note

ReproShot redacts detected secrets, but detection is best effort. Review every generated file before sharing it. Live terminal output is unchanged.

## Install

After the package is published:

```bash
npx reproshot -- npm test
```

The npm package has not been published yet.

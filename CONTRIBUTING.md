# Contributing

ReproShot is a small local CLI. Changes should help someone capture and communicate a failing command with less work.

Use Node 20+ and Git. The CI matrix exercises Node 20, 22 and 24 on Ubuntu, Windows and macOS.

```bash
npm ci --ignore-scripts
npm run check
npm run demo
```

Tests use Node's built-in test runner and temporary directories. No real credentials belong in tests. Fixtures must use clearly fake values. Include a regression test for changes to capture, redaction, quoting, score, exit semantics or manifest compatibility.

Keep production dependencies small. Avoid network features, automatic dependency installation, telemetry and unrelated file collection. Capture code must never follow a project symlink into credentials. Generated Markdown, HTML, SVG and reproduction scripts must treat project content as untrusted text.

The manifest contract is in `schema/manifest-v1.schema.json`. Changing the meaning of score points requires a new algorithm ID. Breaking manifest changes require a new schema version. Never normalize captured evidence just to get a higher score.

`npm run demo` creates a real capture from `examples/node` in an isolated Git repository and refreshes `examples/generated` plus `docs/reproshot.svg`. The failure and source commit are deterministic; capture time, duration, installed runtimes and temporary paths reflect the machine that actually ran it. Review generated files before committing. Do not replace captures with invented output.

Describe the problem, resulting behavior and checks actually run in each pull request. Prefer one coherent change over unrelated fixes.

For publishing, follow `docs/releasing.md`. Ordinary pushes and tags never publish a package.

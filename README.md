# ReproShot

**Turn any failing command into a reproducible bug report.**

```bash
npx reproshot -- npm test
```

![ReproShot evidence card from an actual failing demo capture](docs/reproshot.svg)

**Pre-release:** the npm package has not been published by this project. Use the source installation below until a release is available.

A small local CLI that runs your command, streams its output, redacts detected secrets and saves a portable report. No accounts, uploads or hosted services.

**Before:** “Tests fail on my machine.” A screenshot, a missing command, three rounds of questions.

**After:** the command, exit status, runtime versions, Git state, reviewed logs and reproduction helpers in one folder.

## Try it

Requires Node.js 20+ and the runtime for your command. Designed for Windows, Linux and macOS; the CI matrix covers Node 20, 22 and 24 on all three.

Until the npm release is published:

```bash
git clone https://github.com/t1ktakdev/ReproShot.git
cd ReproShot
npm ci --ignore-scripts
npm run build
npm link
```

Then run in your project:

```bash
reproshot -- npm test
reproshot -- pnpm build
reproshot -- cargo test
reproshot -- pytest
```

The wrapped command runs directly with its argument boundaries preserved. Shell operators are not interpreted by ReproShot; explicitly invoke your shell when you need a pipeline. Normal stdin is inherited. Output streams use pipes, so commands that require a TTY can behave differently.

## Share the useful part

```bash
reproshot issue                          # latest capture in this directory
reproshot issue .reproshot/<capture-id>   # a specific capture
```

This prints Markdown for you to review and paste. It never posts to GitHub. Open `report.html` locally for the complete visual report, or share `reproshot.svg` for the evidence summary.

Each `.reproshot/<timestamp-id>/` contains:

| File                             | Purpose                                                               |
| -------------------------------- | --------------------------------------------------------------------- |
| `report.md` / `report.html`      | Readable report, static HTML with dark and light themes               |
| `reproshot.svg`                  | Locally generated, shareable Repro Score card                         |
| `manifest.json`                  | Structured evidence using [schema v1](schema/manifest-v1.schema.json) |
| `reproduce.sh` / `reproduce.ps1` | Reviewed-command helpers; no dependency installation                  |
| `stdout.log` / `stderr.log`      | Redacted, bounded command output                                      |
| `changes.patch`                  | Eligible Git text changes, when useful                                |
| `SHA256SUMS`                     | File hashes for integrity checks                                      |

Source and dependencies are not bundled. Restore the source revision and prepare the project yourself, then run the appropriate helper **from the project working directory**. Helpers stop if argv was sanitized or shortened. Review patches before applying them. Add `.reproshot/` to your `.gitignore` before making captures part of your workflow.

## Privacy and limits

ReproShot redacts detected secrets; it cannot guarantee a report is safe to share. Review every file. **Live terminal output is unchanged**, including any secrets the command prints.

It does not enumerate environment variable values or read `.env`, SSH keys, credential stores, browser data or unrelated files. It collects eligible tracked Git changes, respects ignore rules, excludes credential-like paths, and omits binary or oversized changes. Untracked contents are never included.

Logs retain at most 1 MiB per stream plus a truncation notice; patches are capped at 256 KiB. Report previews retain 16 KiB per stream. Truncation and missing evidence are recorded explicitly. See the [capture contract](docs/capture-contract.md) and [security policy](SECURITY.md) for boundaries and limitations.

## Repro Score

A deterministic measure of available evidence, **not a promise that the bug will reproduce**. The same manifest evidence always yields the same score. Missing evidence earns no points; redaction never adds points.

| Evidence                                         | Points |
| ------------------------------------------------ | -----: |
| Exact retained argv                              |     20 |
| Started command returned an exit code            |     15 |
| OS, architecture and sanitized directory         |     10 |
| A detected runtime beyond the Node host          |     10 |
| Git revision                                     |     15 |
| Clean working tree or complete eligible patch    |     10 |
| Both logs captured without truncation            |     10 |
| Both reproduction helpers need no argument edits |     10 |

The manifest includes the `evidence-v1` breakdown. [Scoring details and caveats](docs/capture-contract.md#scoring).

## Exit codes and automation

```bash
reproshot --json -- npm test
```

JSON mode emits one summary object to stdout and sends both live child streams to stderr. Saved logs remain separate. Color is used only for terminal summaries attached to a TTY, and `NO_COLOR` disables it.

| Situation                                      |                                                        ReproShot exit code |
| ---------------------------------------------- | -------------------------------------------------------------------------: |
| Command completes, including failure           |                                                    The command's exit code |
| Ctrl+C / SIGINT                                |                                                                        130 |
| SIGTERM                                        |                                                                        143 |
| Other supported signal                         |                                                        128 + signal number |
| Executable not found / cannot start            |                                                                  127 / 126 |
| Invalid invocation or unreadable issue capture |                                                                          2 |
| Cannot save a capture                          | 74, unless a nonzero command result is already available; then preserve it |

Interrupted captures are marked `interrupted`. Unfinished writes stay under `.pending-*` and are never selected as completed captures. SIGKILL or power loss cannot be finalized. [Process handling and Windows limitations](docs/capture-contract.md#process-handling).

## Develop

```bash
npm run check
npm run demo
```

Tests exercise capture, redaction, quoting, exit codes, Git exclusions, interrupted commands and generated output. The [Node, Python and Rust examples](examples/) intentionally fail. The card above comes from [the committed demo bundle](examples/generated/), which `npm run demo` regenerates from a real execution.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Release procedure](docs/releasing.md) · [MIT license](LICENSE)

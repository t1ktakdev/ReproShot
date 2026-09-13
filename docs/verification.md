# Local verification

Checked locally and in GitHub Actions on 2026-09-13:

| Check                                     | Result                                                                |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `npm run typecheck`                       | Passed                                                                |
| `npm run build`                           | Passed                                                                |
| Test suite on Node 20.20.2                | 74 passed, 2 Windows-only tests skipped                               |
| Test suite on Node 22.23.2                | 74 passed, 2 Windows-only tests skipped                               |
| Test suite on Node 24.19.0                | 74 passed, 2 Windows-only tests skipped                               |
| `npm run format:check`                    | Passed                                                                |
| `npm pack` and installed CLI smoke test   | Passed                                                                |
| Test suite on Windows x64 / Node 24       | 75 passed, 6 POSIX-only tests skipped                                 |
| GitHub Actions: Windows / Node 20, 22, 24 | Passed                                                                |
| GitHub Actions: Ubuntu / Node 20, 22, 24  | Passed                                                                |
| GitHub Actions: macOS / Node 20, 22, 24   | Passed                                                                |
| Node fixture through `npm run demo`       | Expected failure captured, exit 1, two detected fake secrets redacted |
| Python fixture through the installed CLI  | Expected failure captured, exit 1                                     |
| Generated demo SHA256SUMS                 | Verified                                                              |
| SVG XML and local raster rendering        | Verified; card inspected                                              |

The full nine-job matrix passed in [GitHub Actions run 34763525753](https://github.com/t1ktakdev/ReproShot/actions/runs/34763525753). Windows coverage includes command-shim resolution and literal arguments, PowerShell replay, exit codes and requested interruption. Cargo was unavailable for the original local Linux verification, so the standalone Rust fixture was not run there. The HTML escaping and report structure have automated tests; a browser visual check was blocked by the original preview environment's local-URL policy.

To repeat the local gate, run `npm ci --ignore-scripts`, `npm run check`, `npm run format:check` and `npm run demo`. Cross-platform CI must pass before publishing. This file records completed checks, not a compatibility certification.

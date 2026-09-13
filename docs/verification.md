# Local verification

Checked on Linux x64 on 2026-09-13:

| Check                                    | Result                                                                |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `npm run typecheck`                      | Passed                                                                |
| `npm run build`                          | Passed                                                                |
| Test suite on Node 20.20.2               | 74 passed, 2 Windows-only tests skipped                               |
| Test suite on Node 22.23.2               | 74 passed, 2 Windows-only tests skipped                               |
| Test suite on Node 24.19.0               | 74 passed, 2 Windows-only tests skipped                               |
| `npm run format:check`                   | Passed                                                                |
| `npm pack` and installed CLI smoke test  | Passed                                                                |
| Node fixture through `npm run demo`      | Expected failure captured, exit 1, two detected fake secrets redacted |
| Python fixture through the installed CLI | Expected failure captured, exit 1                                     |
| Generated demo SHA256SUMS                | Verified                                                              |
| SVG XML and local raster rendering       | Verified; card inspected                                              |

The configured Windows/macOS GitHub Actions jobs have not run yet. Windows shim and PowerShell integration tests are included but were skipped on Linux. Cargo was unavailable here, so the Rust fixture has not been executed in this environment. The HTML escaping and report structure have automated tests; a browser visual check was blocked by the preview environment's local-URL policy.

To repeat the local gate, run `npm ci --ignore-scripts`, `npm run check`, `npm run format:check` and `npm run demo`. Cross-platform CI must pass before publishing. This file records completed checks, not a compatibility certification.

# ReproShot: failure

```text
npm test
```

## Result

| Evidence | Captured value |
| --- | --- |
| Exit code | 1 |
| Signal | none |
| Duration | 0.28s |
| Repro Score | 100/100 (evidence-v1) |
| Captured | 2026-09-13T13:20:27.722Z |
| OS / architecture | linux 6.18.44 / x64 |
| Working directory | /tmp/reproshot-demo-GezJVt |
| Commit | ab9e455f17d3754be6f3d65a26e7b5683358b801 |
| Branch | main |
| Dirty tree | false |
| Patch | none |
| Runtime versions | node 24.19.0; npm 11.9.0; pnpm 11.19.0; python 3.12.14; pip 26.2.1; java 17.0.20 |
| Detected secrets redacted | 2 |
| Log truncation | stdout: false; stderr: false |
| Report preview truncation | false |

## Reproduce

Captured on linux x64. Versions: node 24.19.0, npm 11.9.0, pnpm 11.19.0, python 3.12.14, pip 26.2.1, java 17.0.20.
Use the project working directory (/tmp/reproshot-demo-GezJVt). Restore source revision ab9e455f17d3754be6f3d65a26e7b5683358b801, review any patch, and prepare dependencies yourself.
Environment variable values were not collected. Review the command before running.

Run from the project directory after reviewing the helper:

```text
sh /path/to/capture/reproduce.sh
# Windows PowerShell:
& C:\path\to\capture\reproduce.ps1
```

## stderr

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
Authorization: [REDACTED]
node:assert:152
  throw new AssertionError(obj);
  ^

AssertionError [ERR_ASSERTION]: 20% off 50 should be 40

30 !== 40

    at Object.<anonymous> (/tmp/reproshot-demo-GezJVt/test.cjs:8:8)
    at Module._compile (node:internal/modules/cjs/loader:1872:14)
    at Object..js (node:internal/modules/cjs/loader:2003:10)
    at Module.load (node:internal/modules/cjs/loader:1594:32)
    at Module._load (node:internal/modules/cjs/loader:1396:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: 30,
  expected: 40,
  operator: 'strictEqual',
  diff: 'simple'
}

Node.js v24.19.0

```

## stdout

```text

> test
> node test.cjs

checkout / applies a 20% discount
API_KEY=[REDACTED]

```

## Capture notes

- Redacted detected secrets. Detection is best effort; review all files before sharing. Live terminal output is unchanged. Environment variable values were not collected.
- Git state was collected before execution. Source files and dependencies are not bundled.
- Child stdout/stderr use pipes; TTY-dependent commands may behave differently.

## Bundle

- [report.md](report.md)
- [report.html](report.html)
- [reproshot.svg](reproshot.svg)
- [manifest.json](manifest.json)
- [reproduce.sh](reproduce.sh)
- [reproduce.ps1](reproduce.ps1)
- [stdout.log](stdout.log)
- [stderr.log](stderr.log)
- [SHA256SUMS](SHA256SUMS)

Repro Score measures evidence completeness, not whether the bug will reproduce. Review all files before sharing.

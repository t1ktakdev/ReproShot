# Capture contract

## Evidence

Schema v1 is defined in `schema/manifest-v1.schema.json`. The CLI version is independent of the schema version. Unknown schema versions are rejected by `reproshot issue`.

A capture records argv boundaries, exit code, signal, command duration in milliseconds, UTC start timestamp, OS release, architecture, sanitized working directory, Git commit/branch/dirty state and detected runtime versions. Git evidence is collected before execution. Duration measures the wrapped command and output draining, excluding pre-capture Git work, runtime probes and report writing.

The child receives the original argv. Saved argv is sanitized: `command.exact` is false whenever sanitization, control-character cleanup, home replacement or the size limit changes it. Helpers then stop with exit 2 until reviewed and edited. A redacted argument cannot be recovered from the report. Commands relying on shell functions or aliases must explicitly invoke the relevant shell.

The manifest captures the Node host version and probes npm, pnpm, Yarn, Bun, Python, pip, Rust, Cargo, Go and Java when found on PATH. Each probe has a 1.8-second timeout and a 4 KiB output cap. Probes run concurrently with the wrapped command; versions describe the available tools, not a locked dependency graph. Missing or timed-out probes are omitted. This does not record project dependency versions or assert that a detected runtime is the runtime the project actually uses. Environment values are not enumerated or exported. The child inherits its normal environment.

## Git

Git generates the patch against HEAD, incorporating net staged and unstaged tracked changes. No manual diff is reconstructed. Staged changes later reversed in the worktree may yield no patch even when the index is dirty; this is marked omitted. Unborn repositories have no revision or patch. Detached HEAD retains the revision with a null branch. Untracked files are counted (Git may collapse untracked directories into one entry); neither their names nor contents are collected.

Ignore rules apply even to tracked candidate files through `git check-ignore --no-index`. Credential-like paths and symbolic links are excluded before content collection. Current and base file sizes are checked. Git binary and submodule changes are omitted. At most 100 tracked change candidates are examined, with a 64 KiB status/change-list limit and a 256 KiB file/patch budget. Oversized patches are omitted entirely, never left looking complete. A status error yields unknown dirty state.

A patch is `complete` only when the tracked changes fit, no candidate was excluded, and no untracked entries are present. Sanitization changes it to `partial`; redaction or path replacement may make the patch unusable without editing. `none` means there was no needed patch; `omitted` means evidence could not be included. The report explains exclusions without exposing excluded file names.

Git captures source context, not a sandbox or snapshot. Commands can change files after metadata collection. Files not represented by a patch still need to be provided separately by the reporter after review.

## Size and storage

- Each raw stream retains its first 1 MiB in memory. All output continues streaming live regardless of this limit.
- When clipping occurs, the final retained line is dropped in full to avoid retaining a partial secret. A single oversized line may therefore leave an empty log plus a notice.
- Persisted sanitized logs are bounded to the same budget plus a short truncation annotation. Bytes seen, bytes saved and truncation flags are separate fields.
- Markdown and HTML include the first 16 KiB of each sanitized log, with explicit preview notices. Each report has a hard 512 KiB output limit.
- Saved argv has a 24 KiB budget. Over-budget arguments are replaced with an omission marker, helpers stop and exact-command points are lost.
- Git patches have a 256 KiB budget. Any over-budget sanitized patch is omitted.
- Bundle directories use a UTC timestamp including milliseconds and a random suffix, preventing concurrent capture collisions. Random IDs and timestamps are deliberately not deterministic.
- Files are first written into `.pending-<id>`, initially with an `INCOMPLETE` marker. A same-filesystem rename makes a finished bundle visible. Failures clean up pending output where possible; abrupt death can leave a pending directory. Power-loss durability is not promised.
- No global configuration, telemetry or network service is used. No environment dump, command history or user configuration is collected.

## Process handling

The CLI spawns a command directly. On Windows it resolves commands with PATH/PATHEXT; native executables still run directly, while `.cmd` and `.bat` wrappers necessarily run through `cmd.exe` with metacharacters escaped across both parser passes. Batch arguments containing line breaks are rejected with exit 126 instead of entering an ambiguous shell parse, and their helpers remain blocked. Native argv is retained as passed to ReproShot; any expansion already performed by the caller's shell cannot be recovered.

Normal stdin is inherited. Stdout and stderr are piped, independently streamed with backpressure and recorded. Their relative interleaving is not promised and TTY detection in the child sees pipes. Full-screen terminal apps, password prompts requiring a controlling terminal and long-lived interactive sessions are outside v1's focus.

On POSIX, the child runs in a separate process group. ReproShot forwards SIGINT, SIGTERM and SIGHUP to that group. After three seconds it escalates to SIGKILL; a second signal escalates immediately. ReproShot finalizes a report with `status: interrupted` and returns 128 plus the requested signal number, even if the child handles the signal and returns zero.

On Windows there is no portable Node API for POSIX signal forwarding to arbitrary child trees. ReproShot uses `taskkill /T /F` when its signal handler is invoked, which terminates the process tree without a graceful POSIX shutdown. Forced termination of ReproShot itself cannot run a handler. Native POSIX signal tests run on Unix; Windows CI checks shim execution and PowerShell rendering. Windows signal behavior is not claimed equivalent to Unix.

A child descendant that keeps output pipes open after the main child exits gets two seconds to drain; the tree is then terminated and logs are marked truncated. Deliberately detached processes can escape a process group; ReproShot is not a process-isolation tool.

The shell helper uses POSIX single-quote escaping. The PowerShell helper uses literal single-quoted arguments and the call operator for native executables. For captured Windows batch commands, it starts `cmd.exe` through .NET with a pre-escaped command line matching the capture's two parser passes. Use PowerShell 7.3+ for native arguments containing quotes or empty strings; older Windows PowerShell native argument passing can alter them.

## Scoring

`evidence-v1` is calculated solely from manifest evidence by `src/score.ts`. Each item earns its full weight or zero. There are no random bonuses or deductions based on guessed quality.

| Item                 | Requirement                                                | Weight |
| -------------------- | ---------------------------------------------------------- | -----: |
| Exact command        | `command.exact` and no metadata truncation                 |     20 |
| Exit result          | Non-null exit code and not a spawn error                   |     15 |
| Environment          | Nonempty OS, architecture and sanitized cwd                |     10 |
| Runtime versions     | At least one detected runtime besides the Node host        |     10 |
| Git revision         | Non-null commit                                            |     15 |
| Working tree         | Git available and either clean or complete patch           |     10 |
| Logs                 | Neither stream truncated; empty streams are valid evidence |     10 |
| Reproduction scripts | Both helpers present and no argument edits required        |     10 |

A sanitized patch loses working-tree credit. A command changed by home-path replacement loses exact-command and ready-helper credit. A successful command can receive 100: this is evidence completeness, not failure severity. An interrupted process that returned an exit code can earn exit-result points; the interruption status remains visible.

Runtime points indicate additional toolchain context, not that the exact required version is installed on someone else's machine. Dependencies, external services, data, hardware, secrets and timing-dependent behavior can still prevent reproduction at 100. The score is neither a security certification nor a promise that a report contains everything needed.

## Issue generation

`reproshot issue` searches only `.reproshot` in the current directory. It picks the newest timestamped directory with a completion checksum file and ignores `.pending-*` directories. A malformed latest completed manifest raises an error rather than silently selecting another capture. Explicit capture paths are accepted, including absolute paths. Symlinked capture directories and linked/oversized files are rejected. Issue generation re-runs sanitization before printing. It performs no posting or network requests.

# Security

ReproShot redacts detected secrets. It cannot guarantee that a report is safe to share.

Review every generated file, especially logs and patches, before posting it. Output can contain personal data, proprietary source, custom credentials or encoded secrets that pattern detection does not recognize. Repro Score is an evidence-completeness measure, not a security rating.

## Collection boundaries

- No environment-variable values are enumerated or serialized. The child inherits its normal environment so the wrapped command can run. If the child prints values, recognizable secret patterns are redacted from the saved output.
- Live terminal stdout/stderr are passed through unchanged, including secrets the child prints. Terminal recording tools can record that original output.
- The collector does not open `.env` files, SSH keys, credential stores, browser data or unrelated files. Git patch collection excludes ignored paths and credential-like paths even when tracked. It does not collect untracked file contents.
- Git and installed runtime version commands are executed from the project directory. They are local executables chosen by PATH and may load their own configuration. Use ReproShot only with commands and projects you trust. ReproShot is not a sandbox. The wrapped command can read files or access the network itself.
- Git external diff, text conversion and filesystem-monitor hooks are disabled for metadata collection. Runtime probes disable Corepack downloads. No setup commands are generated or run automatically.
- Raw captured logs are retained only in bounded process memory until redaction. Only redacted material is written to bundle files. A clipped final log line is dropped to avoid keeping a token fragment. Crash dumps, swap and the user's terminal are outside this boundary.
- Private keys, common provider tokens, JWTs, credential URLs, bearer/basic authorization and obvious password, token and key assignments are detected. Detection is heuristic: encoded, fragmented across different streams, custom-formatted or unusually short secrets can evade matching. Home path replacement covers the current user's home, not every other user's identity or every absolute path.
- Sanitized commands are marked as altered and their helpers refuse to run. Sanitized patches are partial and may not apply cleanly.
- Unix bundle directories use mode 0700 and files use 0600 (the shell helper uses 0700). Windows inherits the parent directory's ACLs. Keep the project directory private if its output is sensitive.
- A static Content Security Policy and HTML escaping protect report rendering. SVG has no scripts, remote fonts or external images. Shell arguments use literal quoting. Reproduction helpers still execute the captured command when you intentionally run them.

SHA256SUMS detects accidental changes when checked against a trusted copy. It is not a signature, and an attacker who changes a bundle can regenerate it.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** on the repository Security tab if private vulnerability reporting is enabled. If it is unavailable, open an issue containing only a request for a private contact channel. Do not post a working secret, leaked report or exploit details publicly. Use a synthetic reproduction with fake credentials when possible.

Include the ReproShot version, Node version, OS, the smallest synthetic input and the affected output format. Security fixes target the latest release; this project does not promise a response SLA.

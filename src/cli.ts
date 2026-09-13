#!/usr/bin/env node
import { capture, CaptureWriteError } from './capture.js';
import { readIssue } from './issue.js';
import { VERSION } from './types.js';
import { Sanitizer } from './sanitize.js';
const help = `ReproShot — Turn any failing command into a reproducible bug report.

Usage:
  reproshot [--json] -- <command> [...args]
  reproshot issue [capture-directory]
  reproshot --help
  reproshot --version

Examples:
  reproshot -- npm test
  reproshot -- cargo test
  reproshot -- pytest
  reproshot -- pnpm build

Reports are saved locally in .reproshot/<timestamp-id>/.
--json prints one JSON summary to stdout; live child output goes to stderr.
The wrapped command's exit code is preserved. See README for signals and errors.
No uploading, package installation or environment-value collection.
`;
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--version', '-v'].includes(args[0]!)) {
    console.log(VERSION);
    return;
  }
  if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
    console.log(help);
    return;
  }
  if (args[0] === 'issue') {
    if (args.length > 2) {
      console.error('Usage: reproshot issue [capture-directory]');
      process.exitCode = 2;
      return;
    }
    try {
      process.stdout.write(await readIssue(args[1]));
    } catch {
      console.error(
        'ReproShot: cannot read capture. Check the directory, manifest version and bundle files.',
      );
      process.exitCode = 2;
    }
    return;
  }
  const separator = args.indexOf('--');
  const flags = args.slice(0, separator);
  if (
    separator < 0 ||
    separator === args.length - 1 ||
    flags.some((a) => a !== '--json') ||
    flags.length > 1
  ) {
    console.error('Usage: reproshot [--json] -- <command> [...args]');
    process.exitCode = 2;
    return;
  }
  const json = flags.includes('--json');
  try {
    const { directory, manifest: m } = await capture(args.slice(separator + 1), {
      stdout: json ? process.stderr : process.stdout,
    });
    process.exitCode = m.result.cliExitCode;
    const safeDirectory = new Sanitizer().sanitize(directory);
    if (json) {
      console.log(JSON.stringify({ schemaVersion: 1, directory: safeDirectory, manifest: m }));
      return;
    }
    const color = process.stderr.isTTY && !('NO_COLOR' in process.env);
    const accent = (s: string) => (color ? `\u001b[36m${s}\u001b[0m` : s);
    const title =
      m.status === 'failure'
        ? 'ReproShot captured the failure'
        : m.status === 'success'
          ? 'ReproShot captured the command'
          : `ReproShot capture: ${m.status}`;
    console.error(
      `\n${accent(title)}\n\n  command       ${m.command.display}\n  exit          ${m.result.exitCode ?? m.status}\n  duration      ${(m.result.durationMs / 1000).toFixed(2)}s\n  commit        ${m.git.commit?.slice(0, 7) ?? 'unavailable'}\n  repro score   ${accent(m.score.total + '/100')}\n  secrets       ${m.redaction.detectedSecrets} detected values redacted\n\n  .reproshot/${m.id}/\n\nNext:\n  reproshot issue\n`,
    );
  } catch (error) {
    const code = error instanceof CaptureWriteError ? error.cliExitCode : 74;
    process.exitCode = code;
    const message =
      'Capture could not be saved. Check directory permissions and available disk space.';
    if (json) console.log(JSON.stringify({ schemaVersion: 1, error: message, cliExitCode: code }));
    else console.error('ReproShot: ' + message);
  }
}
// A closed downstream consumer must not produce an uncaught stack trace.
for (const stream of [process.stdout, process.stderr])
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.kill(process.pid, 'SIGTERM');
    else process.exitCode = 74;
  });
await main();

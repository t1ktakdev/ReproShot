import { mkdir, writeFile, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import type { Writable } from 'node:stream';
import { execute } from './process.js';
import { gitMetadata, runtimes } from './metadata.js';
import { Sanitizer, REDACTED } from './sanitize.js';
import { displayCommand } from './command.js';
import { calculateScore } from './score.js';
import { html, markdown, svg, reproductionScripts } from './report.js';
import { LOG_LIMIT, PATCH_LIMIT, PREVIEW_LIMIT, VERSION, type Manifest } from './types.js';

export interface CaptureOptions {
  cwd?: string;
  stdout?: Writable;
  stderr?: Writable;
  logLimit?: number;
}
export class CaptureWriteError extends Error {
  constructor(readonly cliExitCode: number) {
    super('Could not finalize the report bundle. No completed capture was saved.');
  }
}
export async function capture(
  argv: string[],
  options: CaptureOptions = {},
): Promise<{ directory: string; manifest: Manifest }> {
  const cwd = options.cwd ?? process.cwd();
  const logLimit = options.logLimit ?? LOG_LIMIT;
  if (!argv.length || !argv[0]) throw new Error('A command is required after --.');
  if (!Number.isSafeInteger(logLimit) || logLimit < 128 || logLimit > LOG_LIMIT)
    throw new Error('Invalid log size limit.');
  const timestamp = new Date().toISOString();
  const id =
    timestamp.replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '') +
    '-' +
    randomBytes(3).toString('hex');
  const root = path.join(cwd, '.reproshot');
  // Refuse a pre-existing symlink so captured material is not redirected elsewhere.
  try {
    if (!(await lstat(root)).isDirectory())
      throw new Error('.reproshot must be a directory, not a symlink or file.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const source = await gitMetadata(cwd);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const pending = path.join(root, '.pending-' + id),
    directory = path.join(root, id);
  await mkdir(pending, { mode: 0o700 });
  let exit = 74;
  try {
    await writeFile(
      path.join(pending, 'INCOMPLETE'),
      'Capture in progress or interrupted before finalization. Do not treat this as a completed report.\n',
      { mode: 0o600 },
    );
    const detected = runtimes(cwd);
    const result = await execute(
      argv,
      cwd,
      logLimit,
      options.stdout ?? process.stdout,
      options.stderr ?? process.stderr,
    );
    exit = result.cliExitCode || 74;
    const versions = await detected;
    const sanitizer = new Sanitizer();
    const rawOut = result.stdout.text(),
      rawErr = result.stderr.text();
    const rawEnvironment = {
      os: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cwd,
      runtimes: versions,
    };
    sanitizer.discoverArgv(argv);
    for (const value of [
      rawOut,
      rawErr,
      source.patch,
      result.error ?? '',
      ...Object.values(rawEnvironment).filter((v) => typeof v === 'string'),
      source.info.branch ?? '',
      ...Object.values(versions),
    ])
      sanitizer.discover(value);
    const clean = (value: string) => sanitizer.sanitize(value);
    const sanitizeTree = <T>(value: T): T => {
      if (typeof value === 'string') return clean(value) as T;
      if (Array.isArray(value)) return value.map(sanitizeTree) as T;
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeTree(v)])) as T;
      return value;
    };
    let metadataTruncated = false;
    let argvBudget = 24 * 1024;
    const safeArgv: string[] = [];
    for (const arg of argv) {
      let safe = clean(arg);
      if (
        safeArgv.length &&
        /^--?[\w.-]*(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key)[\w.-]*$/i.test(
          argv[safeArgv.length - 1]!,
        )
      )
        safe = REDACTED;
      const size = Buffer.byteLength(safe);
      if (size > argvBudget) {
        safeArgv.push('[ARGUMENTS OMITTED: SIZE LIMIT]');
        metadataTruncated = true;
        break;
      }
      safeArgv.push(safe);
      argvBudget -= size + 4;
    }
    const saveLog = (raw: string, log: typeof result.stdout) => {
      let text = clean(raw);
      if (Buffer.byteLength(text) > logLimit) {
        const buf = Buffer.from(text).subarray(0, logLimit - 80);
        text = buf.subarray(0, Math.max(0, buf.lastIndexOf(10) + 1)).toString('utf8');
        log.truncated = true;
      }
      if (log.truncated) text += '\n[ReproShot: log truncated; clipped final line omitted]\n';
      return text;
    };
    const stdout = saveLog(rawOut, result.stdout),
      stderr = saveLog(rawErr, result.stderr);
    let patch = clean(source.patch);
    const git = sanitizeTree(source.info);
    if (patch !== source.patch && patch) {
      git.patch = 'partial';
      git.notes.push(
        'Patch was sanitized; review it before applying. It may no longer apply cleanly.',
      );
    }
    if (Buffer.byteLength(patch) > PATCH_LIMIT) {
      patch = '';
      git.patch = 'omitted';
      git.notes.push('Sanitized patch exceeded size limit.');
    }
    const exact = safeArgv.length === argv.length && safeArgv.every((a, i) => a === argv[i]);
    const m: Manifest = {
      schemaVersion: 1,
      tool: { name: 'reproshot', version: VERSION },
      id,
      timestamp,
      status: result.interrupted
        ? 'interrupted'
        : result.error
          ? 'spawn-error'
          : result.exitCode === 0
            ? 'success'
            : 'failure',
      command: { argv: safeArgv, exact, display: displayCommand(safeArgv) },
      result: {
        exitCode: result.error ? null : result.exitCode,
        signal: result.signal,
        cliExitCode: result.cliExitCode,
        durationMs: result.durationMs,
        error: result.error ? clean(result.error) : null,
      },
      environment: sanitizeTree(rawEnvironment),
      git,
      logs: {
        stdout: {
          bytesSeen: result.stdout.bytesSeen,
          bytesSaved: Buffer.byteLength(stdout),
          truncated: result.stdout.truncated,
        },
        stderr: {
          bytesSeen: result.stderr.bytesSeen,
          bytesSaved: Buffer.byteLength(stderr),
          truncated: result.stderr.truncated,
        },
      },
      redaction: {
        detectedSecrets: sanitizer.detectedSecrets,
        homePathsReplaced: sanitizer.homePathsReplaced,
        notice:
          'Redacted detected secrets. Detection is best effort; review all files before sharing. Live terminal output is unchanged. Environment variable values were not collected.',
      },
      limits: {
        logBytes: logLimit,
        patchBytes: PATCH_LIMIT,
        previewBytes: PREVIEW_LIMIT,
        metadataTruncated,
        previewsTruncated:
          Buffer.byteLength(stdout) > PREVIEW_LIMIT || Buffer.byteLength(stderr) > PREVIEW_LIMIT,
      },
      reproduction: {
        scripts: true,
        requiresEditing: !exact || !result.replaySafe,
        windowsBatch: result.windowsBatch,
      },
      score: { algorithm: 'evidence-v1', total: 0, items: [] },
      files: [
        'report.md',
        'report.html',
        'reproshot.svg',
        'manifest.json',
        'reproduce.sh',
        'reproduce.ps1',
        'stdout.log',
        'stderr.log',
        ...(patch ? ['changes.patch'] : []),
        'SHA256SUMS',
      ],
      warnings: [
        'Git state was collected before execution. Source files and dependencies are not bundled.',
        'Child stdout/stderr use pipes; TTY-dependent commands may behave differently.',
      ],
    };
    if (result.error) m.warnings.push(m.result.error!);
    if (result.interrupted) m.warnings.push('Command was interrupted; results may be incomplete.');
    if (result.stdout.truncated || result.stderr.truncated)
      m.warnings.push(
        'Logs were truncated by the size limit or a descendant held output pipes open.',
      );
    if (metadataTruncated) m.warnings.push('Command metadata exceeded 24 KiB and was shortened.');
    if (m.limits.previewsTruncated)
      m.warnings.push('Report log previews are shortened to 16 KiB per stream.');
    m.score = calculateScore(m);
    const scripts = reproductionScripts(m);
    const files: Record<string, string> = {
      'report.md': markdown(m, stdout, stderr),
      'report.html': html(m, stdout, stderr),
      'reproshot.svg': svg(m),
      'manifest.json': JSON.stringify(m, null, 2) + '\n',
      'reproduce.sh': scripts.sh,
      'reproduce.ps1': scripts.ps1,
      'stdout.log': stdout,
      'stderr.log': stderr,
    };
    if (patch) files['changes.patch'] = patch;
    const sums: string[] = [];
    for (const [name, text] of Object.entries(files)) {
      if (name.startsWith('report.') && Buffer.byteLength(text) > 512 * 1024)
        throw new Error('Report exceeded 512 KiB limit.');
      await writeFile(path.join(pending, name), text, {
        mode: name === 'reproduce.sh' ? 0o700 : 0o600,
      });
      sums.push(`${createHash('sha256').update(text).digest('hex')}  ${name}`);
    }
    await writeFile(path.join(pending, 'SHA256SUMS'), sums.sort().join('\n') + '\n', {
      mode: 0o600,
    });
    await rm(path.join(pending, 'INCOMPLETE'));
    await rename(pending, directory);
    return { directory, manifest: m };
  } catch {
    await rm(pending, { recursive: true, force: true }).catch(() => {});
    throw new CaptureWriteError(exit);
  }
}

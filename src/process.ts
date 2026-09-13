import spawn from 'cross-spawn';
import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
} from 'node:child_process';
import { statSync } from 'node:fs';
import { constants } from 'node:os';
import { delimiter, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { renderWindowsCmd } from './command.js';

function windowsEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function resolveWindowsCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const pathExt = (windowsEnvironmentValue(env, 'PATHEXT') || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean);
  const hasPath = isAbsolute(command) || /[\\/]/.test(command);
  const roots = hasPath
    ? ['']
    : [
        cwd,
        ...(windowsEnvironmentValue(env, 'PATH') || '')
          .split(delimiter)
          .map((entry) => entry.replace(/^"|"$/g, '')),
      ];
  const extensions = extname(command) ? ['', ...pathExt] : pathExt;
  for (const root of roots) {
    const base = hasPath ? resolve(cwd, command) : join(root || cwd, command);
    for (const extension of extensions) {
      const candidate = base + extension;
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep searching PATH/PATHEXT.
      }
    }
  }
  return null;
}

function spawnLiteral(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32') {
    const env = options.env ?? process.env;
    const resolved = resolveWindowsCommand(command, String(options.cwd ?? process.cwd()), env);
    if (resolved && /\.(?:cmd|bat)$/i.test(resolved)) {
      return nodeSpawn(
        windowsEnvironmentValue(env, 'COMSPEC') || 'cmd.exe',
        ['/d', '/s', '/v:off', '/c', renderWindowsCmd([normalize(resolved), ...args])],
        {
          ...options,
          windowsVerbatimArguments: true,
        },
      ) as ChildProcessWithoutNullStreams;
    }
  }
  return spawn(command, args, options) as ChildProcessWithoutNullStreams;
}

export class BoundedLog {
  private chunks: Buffer[] = [];
  private kept = 0;
  bytesSeen = 0;
  truncated = false;
  constructor(readonly limit: number) {}
  add(chunk: Buffer): void {
    this.bytesSeen += chunk.length;
    const take = Math.min(chunk.length, this.limit - this.kept);
    if (take > 0) this.chunks.push(Buffer.from(chunk.subarray(0, take)));
    this.kept += take;
    if (take < chunk.length) this.truncated = true;
  }
  text(): string {
    let bytes = Buffer.concat(this.chunks);
    // Drop a clipped line in full: retaining half a token can defeat detection.
    if (this.truncated) bytes = bytes.subarray(0, Math.max(0, bytes.lastIndexOf(10) + 1));
    return bytes.toString('utf8');
  }
}
export interface Execution {
  exitCode: number | null;
  signal: string | null;
  cliExitCode: number;
  durationMs: number;
  error: string | null;
  interrupted: boolean;
  replaySafe: boolean;
  windowsBatch: boolean;
  stdout: BoundedLog;
  stderr: BoundedLog;
}
export function signalExit(signal: string): number {
  return 128 + ((constants.signals as Record<string, number>)[signal] ?? 1);
}
export async function execute(
  argv: string[],
  cwd: string,
  limit: number,
  out: Writable,
  err: Writable,
): Promise<Execution> {
  const stdout = new BoundedLog(limit),
    stderr = new BoundedLog(limit);
  const started = performance.now();
  const resolved =
    process.platform === 'win32' ? resolveWindowsCommand(argv[0]!, cwd, process.env) : null;
  if (
    resolved &&
    /\.(?:cmd|bat)$/i.test(resolved) &&
    argv.slice(1).some((arg) => /[\r\n]/.test(arg))
  ) {
    return {
      stdout,
      stderr,
      exitCode: null,
      signal: null,
      cliExitCode: 126,
      durationMs: Math.round(performance.now() - started),
      error: 'Windows batch commands cannot safely receive arguments containing line breaks.',
      interrupted: false,
      replaySafe: false,
      windowsBatch: true,
    };
  }
  const child = spawnLiteral(argv[0]!, argv.slice(1), {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: false,
  });
  let requested: NodeJS.Signals | null = null;
  let error: NodeJS.ErrnoException | null = null;
  let escalation: NodeJS.Timeout | undefined;
  let drain: NodeJS.Timeout | undefined;
  const killTree = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      // Windows lacks portable POSIX process-group signals. Kill the entire tree.
      const killer = spawnLiteral('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        child.kill();
      });
    } else {
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* Already exited. */
      }
    }
  };
  const interrupt = (signal: NodeJS.Signals) => {
    if (requested) {
      killTree('SIGKILL');
      return;
    }
    requested = signal;
    killTree(signal);
    escalation = setTimeout(() => killTree('SIGKILL'), 3000);
    escalation.unref();
  };
  const onInt = () => interrupt('SIGINT'),
    onTerm = () => interrupt('SIGTERM'),
    onHup = () => interrupt('SIGHUP');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  process.on('SIGHUP', onHup);
  const stream = (source: NonNullable<typeof child.stdout>, target: Writable, log: BoundedLog) => {
    source.on('data', (chunk: Buffer) => {
      log.add(chunk);
      if (!target.write(chunk)) {
        source.pause();
        target.once('drain', () => source.resume());
      }
    });
  };
  stream(child.stdout!, out, stdout);
  stream(child.stderr!, err, stderr);
  return new Promise((resolve) => {
    child.on('error', (value) => {
      error = value;
    });
    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(escalation);
      clearTimeout(drain);
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      process.off('SIGHUP', onHup);
      const actualSignal = requested ?? signal;
      resolve({
        stdout,
        stderr,
        exitCode: code,
        signal: actualSignal,
        cliExitCode: actualSignal
          ? signalExit(actualSignal)
          : error
            ? error.code === 'ENOENT'
              ? 127
              : 126
            : (code ?? 1),
        durationMs: Math.round(performance.now() - started),
        error: error?.message ?? null,
        interrupted: actualSignal !== null,
        replaySafe: true,
        windowsBatch: Boolean(resolved && /\.(?:cmd|bat)$/i.test(resolved)),
      });
    };
    child.on('exit', (code, signal) => {
      // A daemon inheriting pipes must not keep the wrapper alive indefinitely.
      drain = setTimeout(() => {
        stdout.truncated = true;
        stderr.truncated = true;
        killTree('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(code, signal);
      }, 2000);
      drain.unref();
    });
    child.on('close', finish);
  });
}

/** Small, time-limited metadata probe; never installs anything or captures environment values. */
export async function probe(
  command: string,
  args: string[],
  cwd: string,
  limit = 64 * 1024,
): Promise<{ text: string; ok: boolean; truncated: boolean }> {
  return new Promise((resolve) => {
    const child = spawnLiteral(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        COREPACK_ENABLE_NETWORK: '0',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    const log = new BoundedLog(limit);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ text: log.text(), ok: ok && !log.truncated, truncated: log.truncated });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(false);
    }, 1800);
    child.stdout?.on('data', (b: Buffer) => {
      log.add(b);
      if (log.truncated) child.kill('SIGKILL');
    });
    child.stderr?.on('data', (b: Buffer) => {
      log.add(b);
      if (log.truncated) child.kill('SIGKILL');
    });
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

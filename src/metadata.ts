import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { probe } from './process.js';
import { PATCH_LIMIT, type GitInfo } from './types.js';

export async function runtimes(cwd: string): Promise<Record<string, string>> {
  const specs: [string, string, string[]][] = [
    ['npm', 'npm', ['--version']],
    ['pnpm', 'pnpm', ['--version']],
    ['yarn', 'yarn', ['--version']],
    ['bun', 'bun', ['--version']],
    ['python', process.platform === 'win32' ? 'python' : 'python3', ['--version']],
    ['pip', process.platform === 'win32' ? 'pip' : 'pip3', ['--version']],
    ['rust', 'rustc', ['--version']],
    ['cargo', 'cargo', ['--version']],
    ['go', 'go', ['version']],
    ['java', 'java', ['-version']],
  ];
  const results = await Promise.all(
    specs.map(async ([name, cmd, args]) => {
      const found = await probe(cmd, args, cwd, 4096);
      // Keep only the actual version, not pip's installation path or arbitrary probe output.
      const version = found.ok
        ? found.text.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+_.][\w.-]+)?\b/)?.[0]
        : undefined;
      return version ? ([name, version] as const) : null;
    }),
  );
  return Object.fromEntries([
    ['node', process.versions.node],
    ...results.filter((x) => x !== null),
  ]);
}
export function sensitivePath(file: string): boolean {
  return (
    file
      .split(/[\\/]/)
      .some((part) =>
        /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.config|\.gnupg|\.git|\.reproshot|\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore))$/i.test(
          part,
        ),
      ) || /(?:^|[/\\])(?:secrets?|credential[-_\w]*)(?:\.[^/\\]*)?$/i.test(file)
  );
}
export async function gitMetadata(cwd: string): Promise<{ info: GitInfo; patch: string }> {
  const git = (args: string[], dir = cwd, limit = 64 * 1024) =>
    probe(
      'git',
      ['--no-pager', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...args],
      dir,
      limit,
    );
  const info: GitInfo = {
    available: false,
    commit: null,
    branch: null,
    dirty: null,
    patch: 'none',
    excludedFiles: 0,
    untrackedFiles: 0,
    notes: [],
  };
  const rootResult = await git(['rev-parse', '--show-toplevel']);
  if (!rootResult.ok) return { info, patch: '' };
  const root = rootResult.text.trim();
  info.available = true;
  const [commit, branch, status] = await Promise.all([
    git(['rev-parse', '--verify', 'HEAD'], root),
    git(['symbolic-ref', '--short', '-q', 'HEAD'], root),
    git(
      [
        'status',
        '--porcelain=v1',
        '--no-renames',
        '-z',
        '--untracked-files=normal',
        '--ignore-submodules=none',
        '--',
        '.',
        ':(exclude).reproshot',
        ':(glob,exclude)**/.reproshot/**',
      ],
      root,
    ),
  ]);
  info.commit = commit.ok && /^[a-f0-9]{40,64}\s*$/.test(commit.text) ? commit.text.trim() : null;
  info.branch = branch.ok ? branch.text.trim() : null;
  if (!status.ok) {
    info.patch = 'omitted';
    info.notes.push('Git status exceeded its limit or was unavailable.');
    return { info, patch: '' };
  }
  info.dirty = status.text.length > 0;
  info.untrackedFiles = status.text.split('\0').filter((x) => x.startsWith('?? ')).length;
  if (info.untrackedFiles)
    info.notes.push('Untracked files are counted but their names and contents are not collected.');
  if (!info.dirty) return { info, patch: '' };
  if (!info.commit) {
    info.patch = 'omitted';
    info.notes.push('No base commit or change list available.');
    return { info, patch: '' };
  }
  const records = status.text.split('\0').filter(Boolean);
  if (records.some((record) => /U|AA|DD/.test(record.slice(0, 2)))) {
    info.patch = 'omitted';
    info.notes.push('Unmerged paths need conflict resolution; no patch was collected.');
    return { info, patch: '' };
  }
  const candidates = records
    .filter((record) => !record.startsWith('?? '))
    .map((record) => record.slice(3));
  const eligible: string[] = [];
  for (const file of candidates.slice(0, 100)) {
    if (sensitivePath(file)) {
      info.excludedFiles++;
      continue;
    }
    const ignored = await git(['check-ignore', '--no-index', '-q', '--', file], root);
    if (ignored.ok) {
      info.excludedFiles++;
      continue;
    }
    // Never follow symlinks while checking file limits.
    let safe = true;
    let current = root;
    for (const part of file.split('/')) {
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.size > PATCH_LIMIT)) safe = false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') safe = false;
      }
    }
    const oldSize = await git(['cat-file', '-s', `HEAD:${file}`], root);
    if (oldSize.ok && Number(oldSize.text.trim()) > PATCH_LIMIT) safe = false;
    if (!safe) {
      info.excludedFiles++;
      continue;
    }
    eligible.push(file);
  }
  info.excludedFiles += Math.max(0, candidates.length - 100);
  if (!eligible.length) {
    info.patch = 'omitted';
    info.notes.push('No eligible tracked text changes.');
    return { info, patch: '' };
  }
  const diff = await git(
    [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--submodule=short',
      'HEAD',
      '--',
      ...eligible.map((p) => `:(literal)${p}`),
    ],
    root,
    PATCH_LIMIT,
  );
  if (!diff.ok) {
    info.patch = 'omitted';
    info.notes.push('Patch omitted: size limit, timeout or Git error.');
    return { info, patch: '' };
  }
  const sections = diff.text.split(/(?=^diff --git )/m).filter(Boolean);
  const textSections = sections.filter(
    (section) =>
      !/^Binary files .* differ$/m.test(section) &&
      !/^GIT binary patch$/m.test(section) &&
      !/^(?:old mode|new mode|new file mode|deleted file mode) (?:120000|160000)$/m.test(section) &&
      !/^[-+]Subproject commit /m.test(section),
  );
  info.excludedFiles += sections.length - textSections.length;
  const patch = textSections.join('');
  info.patch = patch
    ? info.excludedFiles || info.untrackedFiles
      ? 'partial'
      : 'complete'
    : 'omitted';
  if (info.excludedFiles)
    info.notes.push(
      `${info.excludedFiles} ignored, sensitive, binary, special or oversized changes omitted.`,
    );
  return { info, patch };
}

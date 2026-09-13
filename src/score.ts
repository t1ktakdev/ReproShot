import type { Manifest, ScoreItem } from './types.js';
export function calculateScore(
  m: Pick<
    Manifest,
    'command' | 'result' | 'environment' | 'git' | 'logs' | 'reproduction' | 'status' | 'limits'
  >,
): Manifest['score'] {
  const item = (name: string, max: number, has: boolean, detail: string): ScoreItem => ({
    name,
    max,
    points: has ? max : 0,
    detail,
  });
  const items = [
    item(
      'Exact command',
      20,
      m.command.exact && !m.limits.metadataTruncated,
      'Original argument boundaries and values retained',
    ),
    item(
      'Exit result',
      15,
      m.result.exitCode !== null && m.status !== 'spawn-error',
      'Command started and returned an exit code',
    ),
    item(
      'Environment',
      10,
      !!m.environment.os && !!m.environment.arch && !!m.environment.cwd,
      'OS, architecture and sanitized working directory',
    ),
    item(
      'Runtime versions',
      10,
      Object.keys(m.environment.runtimes).some((k) => k !== 'node'),
      'At least one detected development runtime beyond the Node host',
    ),
    item('Git revision', 15, !!m.git.commit, 'A commit identifies the source revision'),
    item(
      'Working tree',
      10,
      m.git.available && (m.git.dirty === false || m.git.patch === 'complete'),
      'Clean tree or complete eligible working-tree patch',
    ),
    item(
      'Logs',
      10,
      !m.logs.stdout.truncated && !m.logs.stderr.truncated,
      'Both streams captured without truncation; empty streams are valid',
    ),
    item(
      'Reproduction scripts',
      10,
      m.reproduction.scripts && !m.reproduction.requiresEditing,
      'Both helpers can replay retained argv without replacing redacted values',
    ),
  ];
  return { algorithm: 'evidence-v1', total: items.reduce((n, i) => n + i.points, 0), items };
}

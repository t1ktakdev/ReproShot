import { mkdtemp, cp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { capture } from '../dist/capture.js';
// Capture a real run in an isolated Git fixture, not the contributor's working tree.
const project = resolve('.');
const dir = await mkdtemp(join(tmpdir(), 'reproshot-demo-'));
try {
  await cp(join(project, 'examples/node'), dir, { recursive: true });
  await writeFile(join(dir, '.gitignore'), '.reproshot/\n');
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      },
    });
  git('init', '-b', 'main');
  git('config', 'user.name', 'ReproShot demo fixture');
  git('config', 'user.email', 'demo@example.invalid');
  git('add', '.');
  git('commit', '-m', 'test: add deterministic discount failure');
  const { directory, manifest } = await capture(['npm', 'test'], { cwd: dir });
  if (manifest.status !== 'failure') throw new Error('Demo must fail.');
  const destination = join(project, 'examples/generated');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(directory, destination, { recursive: true });
  await writeFile(
    join(project, 'docs/reproshot.svg'),
    await readFile(join(directory, 'reproshot.svg')),
  );
  console.log(
    `\nReal demo capture: ${manifest.score.total}/100; ${manifest.redaction.detectedSecrets} detected secrets redacted.\nSaved examples/generated/ and docs/reproshot.svg.`,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

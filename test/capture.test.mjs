import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { capture } from '../dist/capture.js';
import { readIssue } from '../dist/issue.js';
import { gitMetadata, sensitivePath } from '../dist/metadata.js';
const cli = resolve('dist/cli.js');
const sink = () =>
  new Writable({
    write(b, e, cb) {
      cb();
    },
  });
async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'reproshot test 世界 '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const run = (dir, script, more = {}) =>
  capture([process.execPath, '-e', script], { cwd: dir, stdout: sink(), stderr: sink(), ...more });
function git(dir, ...args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
async function repository(dir) {
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.name', 'ReproShot test fixture');
  git(dir, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(dir, 'source.txt'), 'original\n');
  await writeFile(join(dir, '.gitignore'), 'ignored.txt\n.reproshot/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'test: seed fixture');
}
test('non-Git capture produces complete bundle and verified hashes', async (t) => {
  const dir = await temp(t);
  const { directory, manifest: m } = await run(
    dir,
    'console.log("hello 世界"); console.error("failure"); process.exitCode=3',
  );
  assert.equal(m.status, 'failure');
  assert.equal(m.result.cliExitCode, 3);
  assert.equal(m.git.available, false);
  assert.equal(m.schemaVersion, 1);
  assert.deepEqual((await readdir(directory)).sort(), [...m.files].sort());
  const sums = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
  for (const line of sums.trim().split('\n')) {
    const [hash, file] = line.split('  ');
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(directory, file)))
        .digest('hex'),
      hash,
    );
  }
  assert.match(await readIssue(undefined, dir), /hello 世界/);
  assert.match(await readIssue(directory), /failure/);
});
test('secrets are removed across every persisted format, terminal streams remain original', async (t) => {
  const dir = await temp(t);
  const fake = 'ghp_' + 'Z'.repeat(36);
  let live = '';
  const out = new Writable({
    write(b, e, cb) {
      live += b;
      cb();
    },
  });
  await writeFile(
    join(dir, 'emit.cjs'),
    `process.stdout.write('ghp_');setTimeout(()=>{console.log('${'Z'.repeat(36)}');console.error('password=fake-password-xyz')},20)`,
  );
  const { directory, manifest: m } = await capture([process.execPath, 'emit.cjs'], {
    cwd: dir,
    stdout: out,
    stderr: sink(),
  });
  assert.ok(live.includes(fake));
  assert.equal(m.redaction.detectedSecrets, 2);
  for (const name of m.files) {
    const text = await readFile(join(directory, name), 'utf8');
    assert.ok(!text.includes(fake), name);
    assert.ok(!text.includes('fake-password-xyz'), name);
  }
});
test('sensitive arguments and home paths disable replay helpers', async (t) => {
  const dir = await temp(t);
  const { directory, manifest: m } = await capture(
    [process.execPath, '-e', '', '--', '--token', 'abc', homedir()],
    { cwd: dir, stdout: sink(), stderr: sink() },
  );
  assert.equal(m.command.exact, false);
  assert.ok(m.command.argv.includes('[REDACTED]'));
  assert.equal(m.command.argv.at(-1), '~');
  assert.match(await readFile(join(directory, 'reproduce.sh'), 'utf8'), /exit 2/);
});
test('logs truncate explicitly and score loses log credit', async (t) => {
  const dir = await temp(t);
  const { directory, manifest: m } = await run(
    dir,
    'console.log("start");process.stdout.write("x".repeat(5000))',
    { logLimit: 128 },
  );
  assert.equal(m.logs.stdout.truncated, true);
  assert.equal(m.logs.stdout.bytesSeen, 5006);
  assert.equal(m.score.items.find((i) => i.name === 'Logs').points, 0);
  const text = await readFile(join(directory, 'stdout.log'), 'utf8');
  assert.match(text, /log truncated/);
  assert.ok(text.length < 256);
});
test('clean Git state, dirty text patch and untracked omissions', async (t) => {
  const dir = await temp(t);
  await repository(dir);
  const clean = await gitMetadata(dir);
  assert.equal(clean.info.dirty, false);
  assert.equal(clean.info.branch, 'main');
  assert.ok(clean.info.commit);
  await writeFile(join(dir, 'source.txt'), 'updated\n');
  const changed = await gitMetadata(dir);
  assert.equal(changed.info.patch, 'complete');
  assert.match(changed.patch, /\+updated/);
  await writeFile(join(dir, 'untracked.txt'), 'do not collect');
  const partial = await gitMetadata(dir);
  assert.equal(partial.info.patch, 'partial');
  assert.equal(partial.info.untrackedFiles, 1);
  assert.doesNotMatch(partial.patch, /do not collect/);
});
test('staged and unstaged changes appear in a Git-generated patch', async (t) => {
  const dir = await temp(t);
  await repository(dir);
  await writeFile(join(dir, 'source.txt'), 'staged\n');
  git(dir, 'add', 'source.txt');
  await writeFile(join(dir, 'source.txt'), 'staged\nunstaged\n');
  const r = await gitMetadata(dir);
  assert.match(r.patch, /\+staged\n\+unstaged/);
});
test('ignored, credential, binary, symlink and large tracked files are omitted', async (t) => {
  const dir = await temp(t);
  await repository(dir);
  for (const name of ['.env', 'ignored.txt', 'blob.bin', 'large.txt'])
    await writeFile(join(dir, name), name === 'blob.bin' ? Buffer.from([0, 1, 2]) : 'base\n');
  git(dir, 'add', '-f', '.env', 'ignored.txt', 'blob.bin', 'large.txt');
  git(dir, 'commit', '-m', 'test: exclusion fixtures');
  await writeFile(join(dir, '.env'), 'must-not-be-read\n');
  await writeFile(join(dir, 'ignored.txt'), 'ignored-body\n');
  await writeFile(join(dir, 'blob.bin'), Buffer.from([0, 3, 4]));
  await writeFile(join(dir, 'large.txt'), 'x'.repeat(300000));
  await writeFile(join(dir, 'source.txt'), 'useful\n');
  const r = await gitMetadata(dir);
  assert.equal(r.info.patch, 'partial');
  assert.ok(r.info.excludedFiles >= 4);
  assert.match(r.patch, /useful/);
  assert.doesNotMatch(r.patch, /must-not-be-read|ignored-body|Binary files|large.txt/);
});
test('sanitized patches are marked partial and omit raw values everywhere', async (t) => {
  const dir = await temp(t);
  await repository(dir);
  await writeFile(join(dir, 'source.txt'), 'api_key=fake-patch-value\n');
  const { directory, manifest: m } = await run(dir, 'process.exitCode=1');
  assert.equal(m.git.patch, 'partial');
  assert.match(await readFile(join(directory, 'changes.patch'), 'utf8'), /\[REDACTED\]/);
  for (const name of m.files)
    assert.ok(!(await readFile(join(directory, name), 'utf8')).includes('fake-patch-value'));
});
test('latest issue skips pending and incomplete captures', async (t) => {
  const dir = await temp(t);
  const { directory } = await run(dir, 'console.log("completed")');
  await mkdir(join(dir, '.reproshot', '.pending-99999999'));
  await mkdir(join(dir, '.reproshot', '99999999-999999-999-aaaaaa'));
  assert.match(await readIssue(undefined, dir), /completed/);
  await writeFile(join(directory, 'manifest.json'), '{"schemaVersion":999}');
  await assert.rejects(readIssue(directory), /manifest/);
});
test('no local issue returns a helpful error', async (t) => {
  const dir = await temp(t);
  await assert.rejects(readIssue(undefined, dir), /No local captures/);
});
test(
  'POSIX helper replays literal argv from a path with spaces',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = await temp(t);
    await writeFile(join(dir, 'args.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
    const argv = ['a b', "it's", '$HOME', '', '世界', 'a\nb'];
    const { directory, manifest } = await capture(['node', 'args.cjs', ...argv], {
      cwd: dir,
      stdout: sink(),
      stderr: sink(),
    });
    assert.equal(manifest.command.exact, true);
    assert.deepEqual(
      JSON.parse(
        execFileSync('sh', [join(directory, 'reproduce.sh')], { cwd: dir, encoding: 'utf8' }),
      ),
      argv,
    );
  },
);
test('refuses symlinked capture root', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await temp(t),
    other = await temp(t);
  await symlink(other, join(dir, '.reproshot'));
  await assert.rejects(run(dir, ''), /symlink/);
});
test('non-executable command returns 126', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await temp(t);
  await writeFile(join(dir, 'noexec'), 'no');
  await chmod(join(dir, 'noexec'), 0o600);
  const r = await capture([join(dir, 'noexec')], { cwd: dir, stdout: sink(), stderr: sink() });
  assert.equal(r.manifest.result.cliExitCode, 126);
});
function cliRun(args, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { cwd });
    let out = '',
      err = '';
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
test('--json stdout is exactly one JSON object and child streams go to stderr', async (t) => {
  const dir = await temp(t);
  const r = await cliRun(
    [
      '--json',
      '--',
      process.execPath,
      '-e',
      'console.log("live");console.error("err");process.exitCode=9',
    ],
    dir,
  );
  assert.equal(r.code, 9);
  assert.equal(JSON.parse(r.out).manifest.result.cliExitCode, 9);
  assert.match(r.err, /live/);
  assert.match(r.err, /err/);
});
test('CLI help, version, invalid syntax and NO_COLOR', async (t) => {
  const dir = await temp(t);
  assert.match((await cliRun(['--help'], dir)).out, /Usage:/);
  assert.match((await cliRun(['--version'], dir)).out, /0\.1\.0/);
  assert.equal((await cliRun(['npm', 'test'], dir)).code, 2);
  const r = await cliRun(['--', process.execPath, '-e', ''], dir);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.err, /\x1b\[/);
  assert.match(r.err, /captured the command/);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  test(
    `CLI ${signal} finalizes an explicitly interrupted bundle`,
    { skip: process.platform === 'win32', timeout: 15000 },
    async (t) => {
      const dir = await temp(t);
      const p = spawn(
        process.execPath,
        [
          cli,
          '--json',
          '--',
          process.execPath,
          '-e',
          'console.log("READY");setInterval(()=>{},1000)',
        ],
        { cwd: dir },
      );
      let out = '';
      let sent = false;
      p.stdout.on('data', (b) => (out += b));
      p.stderr.on('data', (b) => {
        if (!sent && b.toString().includes('READY')) {
          sent = true;
          p.kill(signal);
        }
      });
      const code = await new Promise((resolve) => p.on('close', resolve));
      assert.equal(code, signal === 'SIGINT' ? 130 : 143);
      const m = JSON.parse(out).manifest;
      assert.equal(m.status, 'interrupted');
      assert.equal(m.result.signal, signal);
      assert.ok((await readdir(join(dir, '.reproshot'))).every((x) => !x.startsWith('.pending')));
    },
  );
test('npm command works through Windows cmd shim or POSIX executable', async (t) => {
  const dir = await temp(t);
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'reproshot-test-fixture',
      private: true,
      scripts: { test: 'node fail.cjs' },
    }),
  );
  await writeFile(join(dir, 'fail.cjs'), 'console.log("npm fixture");process.exitCode=5');
  const r = await capture(['npm', 'test'], { cwd: dir, stdout: sink(), stderr: sink() });
  assert.equal(r.manifest.result.cliExitCode, 5);
});
test('credential path policy', () => {
  for (const p of [
    '.env',
    'app/.env.local',
    '.ssh/config',
    'keys/server.pem',
    '.npmrc',
    '.git-credentials',
    'config/secrets.json',
  ])
    assert.equal(sensitivePath(p), true, p);
  assert.equal(sensitivePath('src/index.ts'), false);
});
test(
  'Windows cmd shim preserves challenging literal argv',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const dir = await temp(t);
    await writeFile(join(dir, 'args.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
    await writeFile(join(dir, 'shim.cmd'), '@echo off\r\nnode "%~dp0args.cjs" %*\r\n');
    const args = ['a b', '世界', '', 'a"b', 'a&b', '%PATH%', '!bang!', '^caret', '(parens)'];
    const r = await capture([join(dir, 'shim.cmd'), ...args], {
      cwd: dir,
      stdout: sink(),
      stderr: sink(),
    });
    assert.deepEqual(JSON.parse(await readFile(join(r.directory, 'stdout.log'), 'utf8')), args);
  },
);
test(
  'Windows PowerShell helper runs npm shim from a spaced directory',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const dir = await temp(t);
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'helper-fixture',
        private: true,
        scripts: { test: 'node -e "process.exitCode=7"' },
      }),
    );
    const r = await capture(['npm', 'test'], { cwd: dir, stdout: sink(), stderr: sink() });
    const result = await new Promise((resolve) => {
      const p = spawn('pwsh', ['-NoProfile', '-File', join(r.directory, 'reproduce.ps1')], {
        cwd: dir,
        stdio: 'ignore',
      });
      p.on('error', () => resolve(-1));
      p.on('close', resolve);
    });
    assert.equal(result, 7);
  },
);
test('unborn and detached Git states are explicit', async (t) => {
  const dir = await temp(t);
  git(dir, 'init', '-b', 'main');
  await writeFile(join(dir, 'new.txt'), 'untracked');
  const unborn = await gitMetadata(dir);
  assert.equal(unborn.info.commit, null);
  assert.equal(unborn.info.patch, 'omitted');
  await repository(dir);
  git(dir, 'checkout', '--detach');
  const detached = await gitMetadata(dir);
  assert.ok(detached.info.commit);
  assert.equal(detached.info.branch, null);
});
test('oversized command metadata is explicitly shortened', async (t) => {
  const dir = await temp(t);
  const r = await capture([process.execPath, '-e', '', '--', 'a'.repeat(25000)], {
    cwd: dir,
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(r.manifest.limits.metadataTruncated, true);
  assert.equal(r.manifest.command.exact, false);
  assert.equal(r.manifest.reproduction.requiresEditing, true);
});
test('output larger than one MiB streams fully and saves bounded logs', async (t) => {
  const dir = await temp(t);
  let liveBytes = 0;
  const out = new Writable({
    write(b, e, cb) {
      liveBytes += b.length;
      cb();
    },
  });
  const r = await capture(
    [process.execPath, '-e', 'for(let i=0;i<1200;i++)console.log("x".repeat(1000))'],
    { cwd: dir, stdout: out, stderr: sink() },
  );
  assert.equal(liveBytes, 1201200);
  assert.equal(r.manifest.logs.stdout.bytesSeen, liveBytes);
  assert.ok(r.manifest.logs.stdout.bytesSaved <= 1048576 + 128);
  assert.equal(r.manifest.logs.stdout.truncated, true);
});
test('report write failure preserves already-failed command exit and removes pending output', async (t) => {
  const dir = await temp(t);
  await assert.rejects(
    run(
      dir,
      'require("node:fs").rmSync(".reproshot",{recursive:true,force:true});process.exitCode=17',
    ),
    (e) => e.cliExitCode === 17,
  );
});
test('unprinted environment values are never serialized', async (t) => {
  const dir = await temp(t);
  const sentinel = 'fake-environment-sentinel-do-not-collect';
  process.env.REPROSHOT_TEST_SENTINEL = sentinel;
  try {
    const r = await run(dir, 'console.log("ordinary output")');
    for (const name of r.manifest.files)
      assert.ok(!(await readFile(join(r.directory, name), 'utf8')).includes(sentinel));
  } finally {
    delete process.env.REPROSHOT_TEST_SENTINEL;
  }
});
test('Git handles staged renames and Unicode filenames without shell interpretation', async (t) => {
  const dir = await temp(t);
  await repository(dir);
  git(dir, 'mv', 'source.txt', 'space 世界.txt');
  const result = await gitMetadata(dir);
  assert.equal(result.info.patch, 'complete');
  assert.match(result.patch, /space 世界.txt/);
  assert.match(result.patch, /deleted file mode/);
  assert.match(result.patch, /new file mode/);
});

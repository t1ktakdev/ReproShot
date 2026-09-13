import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { execute, BoundedLog, probe } from '../dist/process.js';
const sink = () =>
  new Writable({
    write(chunk, enc, cb) {
      cb();
    },
  });
test('executes argv with spaces, Unicode, quotes and shell metacharacters literally', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'reproshot space 世界 '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const args = [
    'a b',
    'Привет 世界',
    '',
    '$(echo BAD)',
    'a&b',
    'a"b',
    "a'b",
    '%PATH%',
    '!bang!',
    'x\\',
  ];
  let live = '';
  let liveError = '';
  const out = new Writable({
    write(b, e, cb) {
      live += b.toString();
      cb();
    },
  });
  const result = await execute(
    [
      process.execPath,
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1))); console.error("stderr"); process.exitCode=7',
      '--',
      ...args,
    ],
    dir,
    1024,
    out,
    new Writable({
      write(b, e, cb) {
        liveError += b.toString();
        cb();
      },
    }),
  );
  assert.deepEqual(JSON.parse(result.stdout.text()), args);
  assert.equal(result.stdout.text(), live);
  assert.match(result.stderr.text(), /^stderr\n/);
  assert.equal(result.stderr.text(), liveError);
  assert.equal(result.cliExitCode, 7);
});
for (const code of [0, 1, 42, 255])
  test(`preserves exit ${code}`, async () => {
    const r = await execute(
      [process.execPath, '-e', `process.exit(${code})`],
      process.cwd(),
      1024,
      sink(),
      sink(),
    );
    assert.equal(r.cliExitCode, code);
  });
test('missing executable returns 127', async () => {
  const r = await execute(
    ['reproshot-missing-executable-314159'],
    process.cwd(),
    1024,
    sink(),
    sink(),
  );
  assert.equal(r.cliExitCode, 127);
  assert.ok(r.error);
});
test('version probe absence is nonfatal', async () => {
  const r = await probe('reproshot-missing-executable-314159', ['--version'], process.cwd());
  assert.equal(r.ok, false);
});
test('bounded logs discard clipped final line but keep streaming byte counts', () => {
  const b = new BoundedLog(12);
  b.add(Buffer.from('hello\ntoken='));
  b.add(Buffer.from('some-secret-value'));
  assert.equal(b.text(), 'hello\n');
  assert.equal(b.truncated, true);
  assert.equal(b.bytesSeen, 29);
});
test('UTF8 split across buffers is preserved', () => {
  const b = new BoundedLog(1024),
    bytes = Buffer.from('世界🚀');
  for (const byte of bytes) b.add(Buffer.from([byte]));
  assert.equal(b.text(), '世界🚀');
});
test('streams before command completion', async () => {
  let observed = false;
  const start = performance.now();
  const stream = new Writable({
    write(b, e, cb) {
      if (b.toString().includes('ready')) observed = performance.now() - start < 900;
      cb();
    },
  });
  const r = await execute(
    [process.execPath, '-e', 'console.log("ready");setTimeout(()=>{},1200)'],
    process.cwd(),
    1024,
    stream,
    sink(),
  );
  assert.ok(observed);
  assert.ok(r.durationMs >= 1100);
});
test(
  'Windows requested interrupt terminates the child and returns 130',
  { skip: process.platform !== 'win32', timeout: 10000 },
  async () => {
    let interrupted = false;
    const output = new Writable({
      write(chunk, encoding, callback) {
        if (!interrupted && chunk.toString().includes('READY')) {
          interrupted = true;
          process.emit('SIGINT');
        }
        callback();
      },
    });
    const result = await execute(
      [process.execPath, '-e', 'console.log("READY");setInterval(()=>{},1000)'],
      process.cwd(),
      1024,
      output,
      sink(),
    );
    assert.equal(result.interrupted, true);
    assert.equal(result.signal, 'SIGINT');
    assert.equal(result.cliExitCode, 130);
  },
);
test(
  'a descendant holding output pipes cannot hang the wrapper',
  { skip: process.platform === 'win32', timeout: 7000 },
  async () => {
    const script =
      'const {spawn}=require("node:child_process");const p=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:["ignore",1,2]});p.unref();';
    const result = await execute(
      [process.execPath, '-e', script],
      process.cwd(),
      1024,
      sink(),
      sink(),
    );
    assert.equal(result.cliExitCode, 0);
    assert.equal(result.stdout.truncated, true);
    assert.ok(result.durationMs < 5000);
  },
);

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore } from '../dist/score.js';
import { renderSh, renderPowerShell, displayCommand } from '../dist/command.js';
import { markdown, html, svg, reproductionScripts, issueBody, preview } from '../dist/report.js';
export function fixture() {
  const m = {
    schemaVersion: 1,
    tool: { name: 'reproshot', version: '0.1.0' },
    id: 'fixture',
    timestamp: '2026-01-01T00:00:00.000Z',
    status: 'failure',
    command: { argv: ['npm', 'test'], display: 'npm test', exact: true },
    result: { exitCode: 1, signal: null, cliExitCode: 1, durationMs: 4210, error: null },
    environment: {
      os: 'linux',
      release: 'fixture',
      arch: 'x64',
      cwd: '~/project',
      runtimes: { node: '22.0.0', npm: '10.0.0' },
    },
    git: {
      available: true,
      commit: 'a'.repeat(40),
      branch: 'main',
      dirty: false,
      patch: 'none',
      excludedFiles: 0,
      untrackedFiles: 0,
      notes: [],
    },
    logs: {
      stdout: { bytesSeen: 0, bytesSaved: 0, truncated: false },
      stderr: { bytesSeen: 1, bytesSaved: 1, truncated: false },
    },
    limits: {
      logBytes: 1048576,
      patchBytes: 262144,
      previewBytes: 16384,
      metadataTruncated: false,
      previewsTruncated: false,
    },
    reproduction: { scripts: true, requiresEditing: false },
    redaction: { detectedSecrets: 0, homePathsReplaced: true, notice: 'Review before sharing.' },
    warnings: [],
    files: ['report.html', 'stdout.log'],
    score: null,
  };
  m.score = calculateScore(m);
  return m;
}
test('full evidence scores 100, same input yields same score', () => {
  const m = fixture();
  assert.equal(m.score.total, 100);
  assert.deepEqual(calculateScore(m), calculateScore(structuredClone(m)));
});
test('missing evidence subtracts documented points', () => {
  const m = fixture();
  m.git.commit = null;
  m.git.available = false;
  m.environment.runtimes = { node: '22.0.0' };
  m.logs.stdout.truncated = true;
  assert.equal(calculateScore(m).total, 55);
  m.command.exact = false;
  m.reproduction.requiresEditing = true;
  assert.equal(calculateScore(m).total, 25);
});
test('partial patch loses working tree credit', () => {
  const m = fixture();
  m.git.dirty = true;
  m.git.patch = 'partial';
  assert.equal(calculateScore(m).total, 90);
  m.git.patch = 'complete';
  assert.equal(calculateScore(m).total, 100);
});
test('no started process loses exit evidence', () => {
  const m = fixture();
  m.status = 'spawn-error';
  m.result.exitCode = null;
  assert.equal(calculateScore(m).total, 85);
});
test('Windows PowerShell rendering treats arguments literally', () => {
  assert.equal(
    renderPowerShell([
      'C:\\Program Files\\node.exe',
      "it's",
      '$env:HOME',
      '',
      'a&b',
      'a"b',
      '世界',
    ]),
    `& 'C:\\Program Files\\node.exe' 'it''s' '$env:HOME' '' 'a&b' 'a"b' '世界'`,
  );
});
test('POSIX rendering handles spaces, quotes, newlines and expansion', () => {
  assert.equal(
    renderSh(['tool', "it's", '$HOME', '', 'a\nb']),
    "'tool' 'it'\\''s' '$HOME' '' 'a\nb'",
  );
  assert.equal(displayCommand(['npm', 'test']), 'npm test');
});
test('reports are deterministic and HTML escapes hostile log and metadata', () => {
  const m = fixture();
  m.environment.cwd = '<script>alert(1)</script>';
  const log = '<img src=x onerror=alert(1)>';
  assert.equal(html(m, log, ''), html(m, log, ''));
  assert.doesNotMatch(html(m, log, ''), /<script>|<img src=x/);
  assert.match(html(m, log, ''), /&lt;img/);
  assert.match(html(m, log, ''), /Content-Security-Policy/);
});
test('Markdown chooses a fence longer than hostile log fences', () => {
  const body = markdown(fixture(), '```\n# pretend heading\n```', '');
  assert.match(body, /````text/);
});
test('Markdown metadata cannot inject a new block', () => {
  const m = fixture();
  m.environment.cwd = 'safe\n\n# injected';
  m.warnings = ['first\n# injected'];
  const body = markdown(m, '', '');
  assert.doesNotMatch(body, /^# injected$/m);
  assert.match(body, /safe<br><br># injected/);
});
test('preview truncation preserves UTF-8 boundaries', () => {
  const text = 'a'.repeat(16383) + '世界';
  const value = preview(text);
  assert.doesNotMatch(value, /�/);
  assert.match(value, /Preview truncated/);
});
test('issue body is ready to paste without broken local file links', () => {
  const body = issueBody(fixture(), 'ok', 'bad');
  assert.match(body, /Expected behavior/);
  assert.match(body, /npm test/);
  assert.doesNotMatch(body, /\]\(stdout.log\)/);
});
test('SVG is deterministic, self contained, accessible and truthful', () => {
  const m = fixture();
  const image = svg(m);
  assert.equal(image, svg(structuredClone(m)));
  assert.match(image, /100\/100 Repro Score/);
  assert.match(image, /<title/);
  assert.doesNotMatch(image, /<script|<image|href=/);
  m.status = 'success';
  assert.match(svg(m), /SUCCESS/);
});
test('helpers block altered commands and never install dependencies', () => {
  const m = fixture();
  m.reproduction.requiresEditing = true;
  const s = reproductionScripts(m);
  assert.match(s.sh, /exit 2/);
  assert.match(s.ps1, /exit 2/);
  assert.doesNotMatch(s.sh + s.ps1, /npm install|pip install|git apply/);
});

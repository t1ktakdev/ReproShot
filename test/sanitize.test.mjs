import test from 'node:test';
import assert from 'node:assert/strict';
import { Sanitizer, cleanText } from '../dist/sanitize.js';
const cases = [
  ['GitHub classic', 'ghp_' + 'a'.repeat(36)],
  ['GitHub fine grained', 'github_pat_' + 'b'.repeat(50)],
  ['API key', 'sk-proj-' + 'c'.repeat(32)],
  ['AWS access key', 'AKIA' + 'D'.repeat(16)],
  ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.ZmFrZXNpZ25hdHVyZQ'],
  [
    'private key',
    '-----BEGIN RSA PRIVATE KEY-----\nfake-private-data\n-----END RSA PRIVATE KEY-----',
  ],
  ['unterminated private key', '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-private-data'],
  ['connection URL', 'postgresql://alice:fake-pass@localhost/db'],
  ['Slack', 'xoxb-' + '1'.repeat(24)],
];
for (const [name, value] of cases)
  test(`redacts ${name}`, () => {
    const s = new Sanitizer('/home/example');
    const result = s.sanitize('before ' + value + ' after');
    assert.ok(!result.includes(value));
    assert.match(result, /\[REDACTED\]/);
    assert.equal(s.detectedSecrets, 1);
  });
for (const line of [
  'password=hunter2',
  'API_KEY=fake-key-123',
  '"token": "fake-key-123"',
  'Authorization: Bearer fake-key-123',
  'Authorization: Basic YWxpY2U6ZmFrZQ==',
  'https://host/path?token=fake-key-123&x=1',
  'AccountKey=fake-key-123;Endpoint=x',
  'password="multi\nline secret"',
])
  test(`redacts assignment ${line.split(/[=:]/)[0]}`, () => {
    const s = new Sanitizer();
    const value = s.sanitize(line);
    assert.match(value, /\[REDACTED\]/);
    assert.doesNotMatch(value, /hunter2|fake-key-123|YWxpY2U6ZmFrZQ|line secret/);
  });
test('two-pass sanitizer redacts a detected value elsewhere and counts once', () => {
  const s = new Sanitizer();
  s.discover('token=uniquefakevalue');
  assert.equal(s.sanitize('uniquefakevalue'), '[REDACTED]');
  assert.equal(s.sanitize('token=uniquefakevalue'), 'token=[REDACTED]');
  assert.equal(s.detectedSecrets, 1);
});
test('secret argv pairs', () => {
  const s = new Sanitizer();
  s.discoverArgv(['tool', '--access-token', 'fake-argument']);
  assert.equal(s.sanitize('fake-argument'), '[REDACTED]');
});
test('home prefix boundaries and Windows slash forms', () => {
  const s = new Sanitizer('/home/alice');
  assert.equal(s.sanitize('/home/alice/project /home/alice2'), '~/project /home/alice2');
  const w = new Sanitizer('C:\\Users\\Alice');
  assert.equal(w.sanitize('C:\\Users\\Alice\\app C:/Users/Alice/app'), '~\\app ~/app');
});
test('strips terminal control sequences and bidi controls before detection', () => {
  const s = new Sanitizer();
  assert.equal(s.sanitize('to\x1b[31mken=fake-value'), 'token=[REDACTED]');
  assert.equal(cleanText('ok\u202eevil\0'), 'okevil');
});
test('leaves useful ordinary output and Unicode unchanged', () => {
  const value = 'AssertionError: expected 42, got 41\nПривет 世界 🚀';
  assert.equal(new Sanitizer().sanitize(value), value);
});
test('large ordinary output does not cause excessive regex backtracking', { timeout: 3000 }, () => {
  const text = 'x'.repeat(1024 * 1024);
  const start = performance.now();
  assert.equal(new Sanitizer().sanitize(text), text);
  assert.ok(performance.now() - start < 1500);
});
test('JSON-escaped Windows home paths are neutralized', () => {
  const s = new Sanitizer('C:\\Users\\Alice');
  assert.equal(s.sanitize('C:\\\\Users\\\\Alice\\\\app'), '~\\\\app');
});
test('redacts non-Bearer Authorization schemes', () => {
  assert.equal(
    new Sanitizer().sanitize('Authorization: Digest username="fake-user", response="fake-digest"'),
    'Authorization: [REDACTED]',
  );
});
test('short detected values are also removed as standalone words', () => {
  const s = new Sanitizer();
  s.discoverArgv(['tool', '--token', 'abc']);
  assert.equal(s.sanitize('value abc alphabet'), 'value [REDACTED] alphabet');
});
test('Authorization values are protected when repeated outside the header', () => {
  const s = new Sanitizer();
  s.discover('Authorization: Bearer fake-repeated-credential');
  assert.equal(s.sanitize('fake-repeated-credential'), '[REDACTED]');
  assert.equal(s.detectedSecrets, 1);
});

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// Expand test files ourselves: Windows cmd.exe does not expand shell globs.
const files = readdirSync('test')
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => 'test/' + name);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

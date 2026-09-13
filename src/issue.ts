import { readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { issueBody } from './report.js';
import { Sanitizer } from './sanitize.js';
import { LOG_LIMIT, type Manifest } from './types.js';
async function boundedFile(file: string, limit: number): Promise<string> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > limit)
    throw new Error('Capture contains an invalid, linked or oversized file.');
  return readFile(file, 'utf8');
}
function isManifest(m: unknown): m is Manifest {
  if (!m || typeof m !== 'object') return false;
  const v = m as Manifest;
  return (
    v.schemaVersion === 1 &&
    v.tool?.name === 'reproshot' &&
    Array.isArray(v.command?.argv) &&
    v.command.argv.every((x) => typeof x === 'string') &&
    typeof v.command.display === 'string' &&
    typeof v.result?.durationMs === 'number' &&
    !!v.environment?.runtimes &&
    typeof v.environment.cwd === 'string' &&
    !!v.git &&
    Array.isArray(v.git.notes) &&
    !!v.logs?.stdout &&
    !!v.logs.stderr &&
    typeof v.redaction?.detectedSecrets === 'number' &&
    !!v.score &&
    Array.isArray(v.files) &&
    v.files.every((x) => typeof x === 'string') &&
    Array.isArray(v.warnings) &&
    !!v.limits &&
    !!v.reproduction
  );
}
export async function readIssue(directory?: string, cwd = process.cwd()): Promise<string> {
  let selected = directory ? path.resolve(cwd, directory) : null;
  if (!selected) {
    const root = path.join(cwd, '.reproshot');
    let entries;
    try {
      if (!(await lstat(root)).isDirectory()) throw new Error('Invalid capture root.');
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      throw new Error('No local captures. Run reproshot -- <command> first.');
    }
    for (const entry of entries
      .filter((e) => e.isDirectory() && /^\d{8}-\d{6}-\d{3}-[a-f0-9]{6}$/.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name))) {
      const candidate = path.join(root, entry.name);
      try {
        await boundedFile(path.join(candidate, 'SHA256SUMS'), 8192);
        selected = candidate;
        break;
      } catch {
        /* Skip incomplete bundles. */
      }
    }
    if (!selected) throw new Error('No completed local captures.');
  }
  if (!(await lstat(selected)).isDirectory())
    throw new Error('Capture directory must not be a symlink.');
  await boundedFile(path.join(selected, 'SHA256SUMS'), 8192);
  const parsed: unknown = JSON.parse(
    await boundedFile(path.join(selected, 'manifest.json'), 256 * 1024),
  );
  if (!isManifest(parsed))
    throw new Error('Unsupported or invalid manifest; expected schemaVersion 1.');
  const [stdout, stderr] = await Promise.all(
    ['stdout.log', 'stderr.log'].map((name) =>
      boundedFile(path.join(selected!, name), LOG_LIMIT + 128),
    ),
  );
  const body = issueBody(parsed, stdout!, stderr!);
  const sanitizer = new Sanitizer();
  sanitizer.discover(body);
  return sanitizer.sanitize(body);
}

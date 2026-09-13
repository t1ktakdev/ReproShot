import { quotePowerShell, renderSh, renderPowerShell, renderWindowsCmd } from './command.js';
import { PREVIEW_LIMIT, type Manifest } from './types.js';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function preview(text: string): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= PREVIEW_LIMIT) return text;
  let end = PREVIEW_LIMIT;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8') + '\n[Preview truncated; see log file]\n';
}
export function fence(text: string, language = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((x) => x[0].length));
  const edge = '`'.repeat(longest + 1);
  return `${edge}${language}\n${text}\n${edge}`;
}
export function requirements(m: Manifest): string {
  return `Captured on ${m.environment.os} ${m.environment.arch}. Versions: ${Object.entries(
    m.environment.runtimes,
  )
    .map(([k, v]) => `${k} ${v}`)
    .join(
      ', ',
    )}.\nUse the project working directory (${m.environment.cwd}). Restore source revision ${m.git.commit ?? '(not recorded)'}, review any patch, and prepare dependencies yourself.\nEnvironment variable values were not collected. Review the command before running.`;
}
export function reproductionScripts(m: Manifest): { sh: string; ps1: string } {
  const header = requirements(m)
    .split('\n')
    .map((x) => `# ${x}`)
    .join('\n');
  const blocked = m.reproduction.requiresEditing;
  const powerShellCommand = m.reproduction.windowsBatch
    ? `$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = $env:ComSpec
if (-not $start.FileName) { $start.FileName = 'cmd.exe' }
$start.UseShellExecute = $false
$start.Arguments = '/d /s /v:off /c ' + ${quotePowerShell(renderWindowsCmd(m.command.argv))}
$process = [System.Diagnostics.Process]::Start($start)
$process.WaitForExit()
exit $process.ExitCode`
    : `${renderPowerShell(m.command.argv)}
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`;
  return {
    sh: `#!/bin/sh\n${header}\n# Captured argv (POSIX shell quoting):\n${renderSh(m.command.argv)
      .split('\n')
      .map((x) => '# ' + x)
      .join(
        '\n',
      )}\n${blocked ? "printf '%s\\n' 'Command was sanitized or shortened. Restore placeholders and review this file before running.' >&2\nexit 2\n# After review, use the command above.\n" : `exec ${renderSh(m.command.argv)}\n`}`,
    ps1: `${header}\n# Captured argv (PowerShell quoting):\n${renderPowerShell(m.command.argv)
      .split('\n')
      .map((x) => '# ' + x)
      .join(
        '\n',
      )}\n${blocked ? "Write-Error 'Command was sanitized or shortened. Restore placeholders and review this file before running.'\nexit 2\n# After review, use the command above.\n" : `$ErrorActionPreference = 'Stop'\n${powerShellCommand}\n`}`,
  };
}
const markdownInline = (value: unknown) =>
  escapeHtml(String(value)).replaceAll('|', '&#124;').replace(/\r?\n/g, '<br>');
const row = (name: string, value: unknown) => `| ${name} | ${markdownInline(value)} |`;
export function markdown(m: Manifest, stdout: string, stderr: string): string {
  return `# ReproShot: ${m.status}\n\n${fence(m.command.display, 'text')}\n\n## Result\n\n| Evidence | Captured value |\n| --- | --- |\n${[
    row('Exit code', m.result.exitCode ?? 'not available'),
    row('Signal', m.result.signal ?? 'none'),
    row('Duration', `${(m.result.durationMs / 1000).toFixed(2)}s`),
    row('Repro Score', `${m.score.total}/100 (evidence-v1)`),
    row('Captured', m.timestamp),
    row(
      'OS / architecture',
      `${m.environment.os} ${m.environment.release} / ${m.environment.arch}`,
    ),
    row('Working directory', m.environment.cwd),
    row('Commit', m.git.commit ?? 'not available'),
    row('Branch', m.git.branch ?? 'detached or unavailable'),
    row('Dirty tree', m.git.dirty ?? 'unknown'),
    row('Patch', m.git.patch),
    row(
      'Runtime versions',
      Object.entries(m.environment.runtimes)
        .map(([k, v]) => `${k} ${v}`)
        .join('; '),
    ),
    row('Detected secrets redacted', m.redaction.detectedSecrets),
    row('Log truncation', `stdout: ${m.logs.stdout.truncated}; stderr: ${m.logs.stderr.truncated}`),
    row('Report preview truncation', m.limits.previewsTruncated),
  ].join(
    '\n',
  )}\n\n## Reproduce\n\n${markdownInline(requirements(m))}\n\nRun from the project directory after reviewing the helper:\n\n${fence('sh /path/to/capture/reproduce.sh\n# Windows PowerShell:\n& C:\\path\\to\\capture\\reproduce.ps1', 'text')}\n\n${m.reproduction.requiresEditing ? '**The command contains sanitized or shortened values. Helpers stop until you edit them.**\n\n' : ''}## stderr\n\n${fence(preview(stderr) || '(empty)', 'text')}\n\n## stdout\n\n${fence(preview(stdout) || '(empty)', 'text')}\n\n## Capture notes\n\n${[m.redaction.notice, ...m.warnings, ...m.git.notes].map((x) => `- ${markdownInline(x)}`).join('\n')}\n\n## Bundle\n\n${m.files.map((x) => `- [${x}](${x})`).join('\n')}\n\nRepro Score measures evidence completeness, not whether the bug will reproduce. Review all files before sharing.\n`;
}
export function issueBody(m: Manifest, stdout: string, stderr: string): string {
  return markdown(m, stdout, stderr).replace(
    /## Bundle[\s\S]*$/,
    '## Expected behavior\n\n<!-- Describe what should have happened. -->\n\n## Additional context\n\n<!-- Add project-specific setup and attach reviewed bundle files. -->\n\nReproShot redacted detected secrets. Review this report before posting.\n',
  );
}

const statusText = (status: Manifest['status']): string =>
  ({
    success: 'capture succeeded',
    failure: 'capture failed',
    interrupted: 'capture interrupted',
    'spawn-error': 'spawn error',
  })[status];

const statusHeading = (status: Manifest['status']): string => {
  const value = statusText(status);
  return value[0]!.toUpperCase() + value.slice(1);
};

const compactLine = (value: unknown, limit: number): string => {
  const chars = [...String(value).replace(/\s+/gu, ' ').trim()];
  return chars.length <= limit ? chars.join('') : `${chars.slice(0, limit - 1).join('')}…`;
};

const resultSummary = (m: Manifest): string => {
  const result =
    m.status === 'spawn-error'
      ? 'not started'
      : m.result.signal
        ? `signal ${compactLine(m.result.signal, 18)}`
        : m.result.exitCode === null
          ? 'exit unavailable'
          : `exit ${m.result.exitCode}`;
  return `${statusText(m.status)} · ${result} · ${(m.result.durationMs / 1000).toFixed(2)}s`;
};

const runtimeSummary = (m: Manifest): string => {
  const priority = (name: string) => (name === 'node' ? 0 : name === 'npm' ? 1 : 2);
  const entries = Object.entries(m.environment.runtimes).sort(([a], [b]) => {
    const rank = priority(a) - priority(b);
    return rank || (a < b ? -1 : a > b ? 1 : 0);
  });
  if (!entries.length) return 'not detected';
  const visible = entries
    .slice(0, 2)
    .map(([name, version]) => `${compactLine(name, 10)} ${compactLine(version, 16)}`);
  if (entries.length > visible.length) visible.push(`+${entries.length - visible.length}`);
  return visible.join(' · ');
};

const gitSummary = (m: Manifest): string => {
  if (!m.git.available) return 'unavailable';
  const commit = m.git.commit ? compactLine(m.git.commit.slice(0, 7), 7) : 'no commit';
  const branch = m.git.branch ? compactLine(m.git.branch, 24) : 'detached';
  const tree = m.git.dirty === null ? 'unknown' : m.git.dirty ? 'modified' : 'clean';
  return `${commit} · ${branch} · ${tree}`;
};

const logsSummary = (m: Manifest): string =>
  `stdout ${m.logs.stdout.truncated ? 'truncated' : 'captured'} · stderr ${m.logs.stderr.truncated ? 'truncated' : 'captured'}`;

const replaySummary = (m: Manifest): string => {
  if (!m.reproduction.scripts) return 'not available';
  return `reproduce.sh · reproduce.ps1${m.reproduction.requiresEditing ? ' · edit required' : ''}`;
};

export function html(m: Manifest, stdout: string, stderr: string): string {
  const e = escapeHtml;
  const facts = [
    ['Exit', m.result.exitCode ?? m.result.signal ?? 'unavailable'],
    ['Duration', `${(m.result.durationMs / 1000).toFixed(2)}s`],
    ['Commit', m.git.commit?.slice(0, 7) ?? 'unavailable'],
    ['Secrets', `${m.redaction.detectedSecrets} redacted`],
    ['Repro Score', `${m.score.total}/100`],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'"><title>ReproShot · ${e(m.status)}</title><style>
:root{color-scheme:dark light;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--red:#f85149;--green:#3fb950;--amber:#d29922}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,sans-serif}main{max-width:960px;margin:0 auto;padding:36px 24px}header{border-bottom:1px solid var(--line);padding-bottom:18px}.brand{font:600 14px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}h1{font-size:28px;line-height:1.25;margin:6px 0 0}.status-failure,.status-spawn-error{color:var(--red)}.status-success{color:var(--green)}.status-interrupted{color:var(--amber)}h2{font-size:18px;margin:28px 0 12px}.muted,small{color:var(--muted)}.command,pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel);border:1px solid var(--line);padding:16px;border-radius:5px;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}.command{font-size:16px;border-left:3px solid var(--accent);margin:22px 0}.command::before{content:'$ ';color:var(--accent)}.facts{display:grid;grid-template-columns:repeat(5,1fr);border-block:1px solid var(--line)}.fact{padding:13px 14px;border-right:1px solid var(--line)}.fact:first-child{padding-left:0}.fact:last-child{border:0}.fact small{display:block}.fact strong{font:500 13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}dl{display:grid;grid-template-columns:105px minmax(0,1fr);gap:8px 14px;font-size:14px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}a{color:var(--accent)}ul{padding-left:20px}.files{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.files a{display:block;padding:6px 10px;border:1px solid var(--line);border-radius:4px;text-decoration:none;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}footer{border-top:1px solid var(--line);margin-top:30px;padding-top:18px;font-size:12px;color:var(--muted)}summary{cursor:pointer;font-weight:600}details{margin-top:22px}pre{max-height:520px;overflow:auto}.notice{color:var(--muted);font-size:13px}@media(max-width:720px){main{padding:28px 18px}.grid{grid-template-columns:1fr;gap:0}.facts{grid-template-columns:1fr 1fr}.fact,.fact:first-child{padding:12px;border-bottom:1px solid var(--line)}}@media(prefers-color-scheme:light){:root{--bg:#f6f8fa;--panel:#fff;--line:#d0d7de;--text:#1f2328;--muted:#59636e;--accent:#0969da;--red:#cf222e;--green:#1a7f37;--amber:#9a6700}}
</style></head><body><main><header><div class="brand">ReproShot</div><h1 class="status-${e(m.status)}">${e(statusHeading(m.status))}</h1></header><div class="command">${e(m.command.display)}</div><section class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${k}</small><strong>${e(String(v))}</strong></div>`).join('')}</section><div class="grid"><section><h2>Environment</h2><dl><dt>System</dt><dd>${e(m.environment.os + ' ' + m.environment.release + ' / ' + m.environment.arch)}</dd><dt>Directory</dt><dd>${e(m.environment.cwd)}</dd>${Object.entries(
    m.environment.runtimes,
  )
    .map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`)
    .join(
      '',
    )}</dl></section><section><h2>Source state</h2><dl><dt>Commit</dt><dd>${e(m.git.commit ?? 'Not recorded')}</dd><dt>Branch</dt><dd>${e(m.git.branch ?? 'Detached or unavailable')}</dd><dt>Working tree</dt><dd>${m.git.dirty === null ? 'Unknown' : m.git.dirty ? 'Modified' : 'Clean'}</dd><dt>Patch</dt><dd>${e(m.git.patch)}</dd><dt>Captured</dt><dd>${e(m.timestamp)}</dd><dt>Signal</dt><dd>${e(m.result.signal ?? 'None')}</dd></dl></section></div><h2>Reproduce</h2><p class="notice">${e(requirements(m))}</p>${m.reproduction.requiresEditing ? '<p>Helpers stop until sanitized or shortened arguments are restored.</p>' : ''}<pre>${e(renderSh(m.command.argv))}\n\n# PowerShell\n${e(renderPowerShell(m.command.argv))}</pre><details open><summary>stderr ${m.logs.stderr.truncated ? '· truncated' : ''}</summary><pre>${e(preview(stderr) || '(empty)')}</pre></details><details open><summary>stdout ${m.logs.stdout.truncated ? '· truncated' : ''}</summary><pre>${e(preview(stdout) || '(empty)')}</pre></details><h2>Bundle files</h2><ul class="files">${m.files.map((f) => `<li><a href="${e(f)}">${e(f)}</a></li>`).join('')}</ul><details><summary>Evidence behind the score</summary><ul>${m.score.items.map((i) => `<li>${e(i.name)}: ${i.points}/${i.max} — ${e(i.detail)}</li>`).join('')}</ul></details><h2>Capture notes</h2><ul class="notice">${[m.redaction.notice, ...m.warnings, ...m.git.notes].map((x) => `<li>${e(x)}</li>`).join('')}</ul><footer>ReproShot ${e(m.tool.version)} · Static report, no network requests. Score measures evidence completeness, not reproducibility or security guarantees. Review before sharing.</footer></main></body></html>\n`;
}
export function svg(m: Manifest): string {
  const accent =
    m.status === 'success' ? '#3fb950' : m.status === 'interrupted' ? '#d29922' : '#f85149';
  const lines = [
    ['repro score', `${m.score.total}/100`],
    ['git', gitSummary(m)],
    ['runtime', runtimeSummary(m)],
    ['logs', logsSummary(m)],
    ['replay', replaySummary(m)],
    ['secrets redacted', m.redaction.detectedSecrets],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420" role="img" aria-labelledby="title desc"><title id="title">ReproShot: ${m.score.total}/100 Repro Score</title><desc id="desc">${escapeHtml(resultSummary(m))}. ${escapeHtml(compactLine(m.command.display, 74))}. ${m.redaction.detectedSecrets} detected secrets redacted.</desc><rect x="0.5" y="0.5" width="719" height="419" rx="10" fill="#0d1117" stroke="#30363d"/><g font-family="ui-monospace,SFMono-Regular,Consolas,monospace"><text x="32" y="39" fill="#8b949e" font-size="14" font-weight="700" letter-spacing="2">REPROSHOT</text><text x="32" y="70" fill="${accent}" font-size="15">${escapeHtml(resultSummary(m))}</text><path d="M32 91H688" stroke="#30363d"/><text x="32" y="125" fill="${accent}" font-size="15">$</text><text x="50" y="125" fill="#e6edf3" font-size="15">${escapeHtml(compactLine(m.command.display, 74))}</text>${lines.map(([label, value], i) => `<text x="32" y="${174 + i * 31}" fill="#8b949e" font-size="13">${escapeHtml(String(label))}</text><text x="184" y="${174 + i * 31}" fill="#e6edf3" font-size="14">${escapeHtml(compactLine(value, 60))}</text>`).join('')}<path d="M32 373H688" stroke="#30363d"/><text x="32" y="398" fill="#8b949e" font-size="12">Evidence completeness only. Review before sharing.</text></g></svg>\n`;
}

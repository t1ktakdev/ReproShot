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
export function html(m: Manifest, stdout: string, stderr: string): string {
  const e = escapeHtml;
  const facts = [
    ['Exit', m.result.exitCode ?? m.result.signal ?? 'unavailable'],
    ['Duration', `${(m.result.durationMs / 1000).toFixed(2)}s`],
    ['Commit', m.git.commit?.slice(0, 7) ?? 'unavailable'],
    ['Secrets', `${m.redaction.detectedSecrets} redacted`],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'"><title>ReproShot · ${e(m.status)}</title><style>
:root{color-scheme:dark light;--bg:#0c111b;--panel:#141d2b;--line:#293448;--text:#eaf0fa;--muted:#a8b5ca;--accent:#8ce0c3;--red:#ffa2ac}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,sans-serif}main{max-width:1024px;margin:0 auto;padding:48px 24px}header{display:flex;justify-content:space-between;gap:24px;align-items:center}.brand{letter-spacing:.2em;font-size:13px;color:var(--accent);font-weight:750}h1{font-size:clamp(28px,5vw,42px);letter-spacing:-.04em;line-height:1.15;margin:18px 0}h2{font-size:19px;margin:28px 0 14px}.muted,small{color:var(--muted)}.score{flex-shrink:0;text-align:right}.score b{font-size:50px;line-height:1.1;font-weight:650;color:var(--accent)}.score span{display:block;font-size:12px;letter-spacing:.08em}.command,pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel);border:1px solid var(--line);padding:20px;border-radius:12px;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}.command{font-size:17px;border-left:3px solid var(--red);margin:28px 0}.facts{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:12px;overflow:hidden}.fact{padding:18px;border-right:1px solid var(--line)}.fact:last-child{border:0}.fact small{display:block}.fact strong{font-weight:550}.grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}dl{display:grid;grid-template-columns:105px minmax(0,1fr);gap:8px 14px;font-size:14px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}a{color:var(--accent)}ul{padding-left:20px}.files{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.files a{display:block;padding:7px 12px;border:1px solid var(--line);border-radius:7px;text-decoration:none;font:12px ui-monospace,monospace}footer{border-top:1px solid var(--line);margin-top:30px;padding-top:20px;font-size:12px;color:var(--muted)}summary{cursor:pointer;font-weight:600}details{margin-top:22px}pre{max-height:520px;overflow:auto}.notice{color:var(--muted);font-size:13px}@media(max-width:650px){main{padding:28px 18px}.grid{grid-template-columns:1fr;gap:0}.facts{grid-template-columns:1fr 1fr}.score b{font-size:36px}.fact{border-bottom:1px solid var(--line)}}@media(prefers-color-scheme:light){:root{--bg:#f6f8fc;--panel:#fff;--line:#d5dce8;--text:#142039;--muted:#516078;--accent:#0b7056;--red:#c33951}}
</style></head><body><main><header><div><div class="brand">REPROSHOT / LOCAL CAPTURE</div><h1>${m.status === 'failure' ? 'Failure, with context.' : m.status === 'success' ? 'Command captured.' : 'Capture ' + e(m.status) + '.'}</h1><div class="muted">One command. A report you can share.</div></div><div class="score"><b>${m.score.total}</b> / 100<span>REPRO SCORE</span></div></header><div class="command">${e(m.command.display)}</div><section class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${k}</small><strong>${e(String(v))}</strong></div>`).join('')}</section><div class="grid"><section><h2>Environment</h2><dl><dt>System</dt><dd>${e(m.environment.os + ' ' + m.environment.release + ' / ' + m.environment.arch)}</dd><dt>Directory</dt><dd>${e(m.environment.cwd)}</dd>${Object.entries(
    m.environment.runtimes,
  )
    .map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`)
    .join(
      '',
    )}</dl></section><section><h2>Source state</h2><dl><dt>Commit</dt><dd>${e(m.git.commit ?? 'Not recorded')}</dd><dt>Branch</dt><dd>${e(m.git.branch ?? 'Detached or unavailable')}</dd><dt>Working tree</dt><dd>${m.git.dirty === null ? 'Unknown' : m.git.dirty ? 'Modified' : 'Clean'}</dd><dt>Patch</dt><dd>${e(m.git.patch)}</dd><dt>Captured</dt><dd>${e(m.timestamp)}</dd><dt>Signal</dt><dd>${e(m.result.signal ?? 'None')}</dd></dl></section></div><h2>Reproduce</h2><p class="notice">${e(requirements(m))}</p>${m.reproduction.requiresEditing ? '<p>Helpers stop until sanitized or shortened arguments are restored.</p>' : ''}<pre>${e(renderSh(m.command.argv))}\n\n# PowerShell\n${e(renderPowerShell(m.command.argv))}</pre><details open><summary>stderr ${m.logs.stderr.truncated ? '· truncated' : ''}</summary><pre>${e(preview(stderr) || '(empty)')}</pre></details><details open><summary>stdout ${m.logs.stdout.truncated ? '· truncated' : ''}</summary><pre>${e(preview(stdout) || '(empty)')}</pre></details><h2>Bundle files</h2><ul class="files">${m.files.map((f) => `<li><a href="${e(f)}">${e(f)}</a></li>`).join('')}</ul><details><summary>Evidence behind the score</summary><ul>${m.score.items.map((i) => `<li>${e(i.name)}: ${i.points}/${i.max} — ${e(i.detail)}</li>`).join('')}</ul></details><h2>Capture notes</h2><ul class="notice">${[m.redaction.notice, ...m.warnings, ...m.git.notes].map((x) => `<li>${e(x)}</li>`).join('')}</ul><footer>ReproShot ${e(m.tool.version)} · Static report, no network requests. Score measures evidence completeness, not reproducibility or security guarantees. Review before sharing.</footer></main></body></html>\n`;
}
export function svg(m: Manifest): string {
  const rows = m.score.items;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="680" viewBox="0 0 720 680" role="img" aria-labelledby="title desc"><title id="title">ReproShot: ${m.score.total}/100 Repro Score</title><desc id="desc">${escapeHtml(m.command.display)}. ${escapeHtml(m.status)}. ${m.redaction.detectedSecrets} detected secrets redacted.</desc><rect width="720" height="680" rx="24" fill="#0d1421"/><rect x="1" y="1" width="718" height="678" rx="23" fill="none" stroke="#2b384d"/><g font-family="system-ui,Segoe UI,sans-serif"><text x="44" y="58" fill="#8ce0c3" font-size="17" font-weight="700" letter-spacing="4">REPROSHOT</text><text x="676" y="57" text-anchor="end" fill="#a8b5ca" font-size="12">${escapeHtml(m.status.toUpperCase())}</text><text x="44" y="110" fill="#d8e2f2" font-size="23">Reproducibility evidence</text><text x="44" y="185" fill="#f3f7ff" font-size="66" font-weight="650">${m.score.total}<tspan fill="#8495ad" font-size="29"> / 100</tspan></text><rect x="44" y="210" width="632" height="5" rx="2" fill="#29364c"/><rect x="44" y="210" width="${(632 * m.score.total) / 100}" height="5" rx="2" fill="#8ce0c3"/>${rows.map((item, i) => `<text x="44" y="${260 + i * 34}" fill="#d8e2f2" font-size="17">${escapeHtml(item.name)}</text><text x="676" y="${260 + i * 34}" text-anchor="end" fill="${item.points ? '#8ce0c3' : '#8392a9'}" font-size="17">${item.points ? '✓' : '—'}  ${item.points}/${item.max}</text>`).join('')}<path d="M44 526H676" stroke="#29364c"/><text x="44" y="565" fill="#a8b5ca" font-size="16">Detected secrets redacted: ${m.redaction.detectedSecrets}</text><text x="44" y="600" fill="#eaf0fa" font-size="18">${m.reproduction.requiresEditing ? 'Restore placeholders before reproducing' : '1 command to reproduce'}</text><text x="44" y="640" fill="#8392a9" font-size="12">Evidence score, not a guarantee. Review before sharing.</text></g></svg>\n`;
}

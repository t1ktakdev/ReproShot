const cmdMeta = /([()\][%!^"`<>&|;, *?])/g;

export function quoteSh(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function quotePowerShell(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}
export function renderSh(argv: string[]): string {
  return argv.map(quoteSh).join(' ');
}
export function renderPowerShell(argv: string[]): string {
  return '& ' + argv.map(quotePowerShell).join(' ');
}
export function renderWindowsCmd(argv: string[]): string {
  const command = argv[0]!.replace(cmdMeta, '^$1');
  const args = argv.slice(1).map((value) => {
    let escaped = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
    escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
    escaped = `"${escaped}"`.replace(cmdMeta, '^$1');
    // cmd.exe parses once, then a .cmd/.bat shim parses its expanded %* again.
    return escaped.replace(cmdMeta, '^$1');
  });
  return `"${[command, ...args].join(' ')}"`;
}
export function displayCommand(argv: string[]): string {
  return argv.map((arg) => (/^[\w./:@+-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ');
}

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
export function displayCommand(argv: string[]): string {
  return argv.map((arg) => (/^[\w./:@+-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ');
}

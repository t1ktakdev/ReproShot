import { homedir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';

export const REDACTED = '[REDACTED]';
const label = String.raw`(?:[\w.-]{0,96}(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|accountkey|sig|signature)[\w.-]{0,96})`;
const assignment = new RegExp(
  String.raw`((?<![\w.-])(?:["']?${label}["']?)\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&<>"']+)`,
  'gi',
);
const standalone = [
  /-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:sk|rk)-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
];
export function cleanText(value: string): string {
  return stripVTControlCharacters(value).replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    '',
  );
}
/** Two passes let a detected assignment protect the same value elsewhere. No environment scan. */
export class Sanitizer {
  private readonly secrets = new Set<string>();
  homePathsReplaced = false;
  constructor(private readonly home = homedir()) {}
  get detectedSecrets(): number {
    return this.secrets.size;
  }
  private remember(value: string): string {
    if (value && value !== REDACTED && !value.includes(REDACTED)) this.secrets.add(value);
    return REDACTED;
  }
  discover(text: string): void {
    this.patterns(cleanText(text));
  }
  discoverArgv(argv: string[]): void {
    argv.forEach((arg, i) => {
      this.discover(arg);
      if (new RegExp(`^--?${label}$`, 'i').test(arg) && argv[i + 1]) this.remember(argv[i + 1]!);
    });
  }
  private patterns(input: string): string {
    let text = input;
    for (const pattern of standalone) text = text.replace(pattern, (value) => this.remember(value));
    text = text.replace(
      /(\b(?:authorization|proxy-authorization)\s*["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi,
      (_, prefix: string, value: string) => {
        const raw = value.trim().replace(/^["']|["']$/g, '');
        return prefix + this.remember(raw.replace(/^(?:bearer|basic)\s+/i, ''));
      },
    );
    text = text.replace(
      /(\bbearer\s+)([A-Za-z0-9._~+\/-]{6,}=*)/gi,
      (_, prefix: string, value: string) => prefix + this.remember(value),
    );
    text = text.replace(
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s"'<>]+/gi,
      (value) => this.remember(value),
    );
    text = text.replace(assignment, (_, prefix: string, value: string) => {
      const quoted = /^["']/.test(value);
      const raw = quoted ? value.slice(1, -1) : value;
      return prefix + (quoted ? value[0] : '') + this.remember(raw) + (quoted ? value[0] : '');
    });
    return text;
  }
  sanitize(input: string): string {
    let text = this.patterns(cleanText(input));
    // Literal replacement avoids interpreting secret characters as regex syntax.
    for (const value of [...this.secrets].sort((a, b) => b.length - a.length)) {
      // Very short values match standalone words to avoid replacing letters inside other words.
      if (value.length >= 4) text = text.split(value).join(REDACTED);
      else {
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp('(?<![\\w])' + escaped + '(?![\\w])', 'g'), REDACTED);
      }
    }
    const prefixes = [
      ...new Set([this.home, this.home.replaceAll('\\', '/'), this.home.replaceAll('\\', '\\\\')]),
    ].filter((p) => p.length > 1);
    for (const prefix of prefixes) {
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(
        new RegExp(escaped + '(?=[\\\\/\\s"\'`:]|$)', /^[a-z]:/i.test(prefix) ? 'gi' : 'g'),
        () => {
          this.homePathsReplaced = true;
          return '~';
        },
      );
    }
    return text;
  }
}

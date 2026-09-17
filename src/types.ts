export const VERSION = '0.1.1';
export const LOG_LIMIT = 1024 * 1024;
export const PATCH_LIMIT = 256 * 1024;
export const PREVIEW_LIMIT = 16 * 1024;
export interface LogInfo {
  bytesSeen: number;
  bytesSaved: number;
  truncated: boolean;
}
export interface GitInfo {
  available: boolean;
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
  patch: 'none' | 'complete' | 'partial' | 'omitted';
  excludedFiles: number;
  untrackedFiles: number;
  notes: string[];
}
export interface Manifest {
  schemaVersion: 1;
  tool: { name: 'reproshot'; version: string };
  id: string;
  timestamp: string;
  status: 'success' | 'failure' | 'interrupted' | 'spawn-error';
  command: { argv: string[]; exact: boolean; display: string };
  result: {
    exitCode: number | null;
    signal: string | null;
    cliExitCode: number;
    durationMs: number;
    error: string | null;
  };
  environment: {
    os: string;
    release: string;
    arch: string;
    cwd: string;
    runtimes: Record<string, string>;
  };
  git: GitInfo;
  logs: { stdout: LogInfo; stderr: LogInfo };
  redaction: { detectedSecrets: number; homePathsReplaced: boolean; notice: string };
  limits: {
    logBytes: number;
    patchBytes: number;
    previewBytes: number;
    metadataTruncated: boolean;
    previewsTruncated: boolean;
  };
  reproduction: { scripts: boolean; requiresEditing: boolean; windowsBatch?: boolean };
  score: { algorithm: 'evidence-v1'; total: number; items: ScoreItem[] };
  files: string[];
  warnings: string[];
}
export interface ScoreItem {
  name: string;
  points: number;
  max: number;
  detail: string;
}

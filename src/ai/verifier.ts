import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface TscError {
  file: string;
  line: number;
  message: string;
}

export interface VerifyResult {
  ok: boolean;
  /** Errors attributable to the scoped files (or all project errors if no scope). */
  errors: TscError[];
  /** Project-wide error count, for context. */
  totalErrors: number;
}

/**
 * Runs `tsc --noEmit` and parses the errors. When scopeFiles is given, the result's
 * `errors` are filtered to those files (so "did my generated code compile?" is answered
 * without being drowned out by unrelated project errors).
 */
export function verifyTypeScript(scopeFiles: string[] = [], rootDir = process.cwd()): VerifyResult {
  const tsc = path.join(rootDir, 'node_modules', '.bin', 'tsc');
  const bin = fs.existsSync(tsc) ? tsc : 'tsc';

  let raw = '';
  try {
    execFileSync(bin, ['--noEmit', '--pretty', 'false'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e: any) {
    // tsc exits non-zero when there are errors; the report is on stdout.
    raw = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }

  const all: TscError[] = [];
  const re = /^(.+?)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    all.push({ file: m[1].trim(), line: Number(m[2]), message: m[3].trim() });
  }

  const scopeBases = scopeFiles.map((f) => path.basename(f));
  const errors = scopeFiles.length
    ? all.filter((er) => scopeBases.includes(path.basename(er.file)))
    : all;

  return { ok: errors.length === 0, errors, totalErrors: all.length };
}

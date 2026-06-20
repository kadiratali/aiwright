import * as fs from 'fs';
import * as path from 'path';

/**
 * Scans the project for the API surface a generated test would depend on, so the
 * generator reuses what already exists instead of inventing helpers/methods/steps.
 * Heuristic (regex-based) but tuned to this project's conventions; safe if a file
 * is missing — it just contributes nothing.
 */

function read(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

function listTsFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.generated'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Exported helper functions from src/fixtures/data.ts (name + params). */
function dataHelpers(root: string): string[] {
  const src = read(path.join(root, 'src/fixtures/data.ts'));
  const out: string[] = [];
  const re = /export\s+function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(`${m[1]}(${m[2].trim()})`);
  return out;
}

/** Fixture keys available to steps (from the *Fixtures type in src/fixtures/index.ts). */
function fixtures(root: string): string[] {
  const src = read(path.join(root, 'src/fixtures/index.ts'));
  const block = src.match(/type\s+\w*Fixtures\s*=\s*\{([\s\S]*?)\}/);
  if (!block) return [];
  const out: string[] = [];
  const re = /(\w+)\s*:\s*([\w<>[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1]))) out.push(`${m[1]}: ${m[2]}`);
  return out;
}

const METHOD_KEYWORDS = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return', 'super']);

/** Page object classes with their public methods and locator fields. */
function pageObjects(root: string): string[] {
  const out: string[] = [];
  for (const file of listTsFiles(path.join(root, 'src/pages'))) {
    const src = read(file);
    const cls = src.match(/export\s+class\s+(\w+)/);
    if (!cls) continue;

    const methods: string[] = [];
    const methodRe = /^\s*(?:public\s+|async\s+)*([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*(?::[^={]+)?\{/gm;
    let m: RegExpExecArray | null;
    while ((m = methodRe.exec(src))) {
      if (METHOD_KEYWORDS.has(m[1])) continue;
      methods.push(`${m[1]}(${m[2].trim()})`);
    }

    const fields: string[] = [];
    const fieldRe = /^\s*readonly\s+(\w+)/gm;
    while ((m = fieldRe.exec(src))) fields.push(m[1]);

    let line = `${cls[1]}`;
    if (methods.length) line += `: ${[...new Set(methods)].join(', ')}`;
    if (fields.length) line += ` | locators: ${[...new Set(fields)].join(', ')}`;
    out.push(line);
  }
  return out;
}

/** Existing Gherkin step phrasings (so the generator reuses them, never redefines). */
function steps(root: string): string[] {
  const out: string[] = [];
  for (const file of listTsFiles(path.join(root, 'src/steps'))) {
    const src = read(file);
    const re = /\b(Given|When|Then)\(\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}

/** Builds a compact API-surface block for the generator prompt. Empty string if nothing found. */
export function readProjectSurface(root = process.cwd()): string {
  const helpers = dataHelpers(root);
  const fix = fixtures(root);
  const pages = pageObjects(root);
  const stepList = steps(root);

  const sections: string[] = [];
  if (helpers.length) sections.push(`Data helpers (src/fixtures/data.ts):\n- ${helpers.join('\n- ')}`);
  if (fix.length) sections.push(`Fixtures available to steps (destructure from the first arg):\n- ${fix.join('\n- ')}`);
  if (pages.length) sections.push(`Page objects (src/pages):\n- ${pages.join('\n- ')}`);
  if (stepList.length) sections.push(`Existing step definitions (REUSE verbatim; do NOT redefine):\n- ${stepList.join('\n- ')}`);

  return sections.join('\n\n');
}

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

/** Existing Gherkin step phrasings under a steps dir (so the generator reuses, never redefines). */
function steps(root: string, dir = 'src/steps'): string[] {
  const out: string[] = [];
  for (const file of listTsFiles(path.join(root, dir))) {
    const src = read(file);
    const re = /\b(Given|When|Then)\(\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}

/** Classes with their public methods, found under the given dirs (clients, base client). */
function classesIn(root: string, dirs: string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    for (const file of listTsFiles(path.join(root, dir))) {
      const src = read(file);
      const cls = src.match(/export\s+(?:abstract\s+)?class\s+(\w+)/);
      if (!cls) continue;
      const methods: string[] = [];
      const methodRe = /^\s*(?:public\s+|protected\s+|async\s+)*([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*(?::[^={]+)?\{/gm;
      let m: RegExpExecArray | null;
      while ((m = methodRe.exec(src))) {
        if (METHOD_KEYWORDS.has(m[1])) continue;
        methods.push(`${m[1]}(${m[2].trim()})`);
      }
      out.push(methods.length ? `${cls[1]}: ${[...new Set(methods)].join(', ')}` : cls[1]);
    }
  }
  return out;
}

/** Contract validators: exported interfaces + validateXxx functions under src/api/contracts. */
function apiContracts(root: string): string[] {
  const out: string[] = [];
  for (const file of listTsFiles(path.join(root, 'src/api/contracts'))) {
    const src = read(file);
    let m: RegExpExecArray | null;
    const ifaceRe = /export\s+interface\s+(\w+)/g;
    while ((m = ifaceRe.exec(src))) out.push(`interface ${m[1]} (${path.basename(file)})`);
    const fnRe = /export\s+function\s+(validate\w*)\s*\(([^)]*)\)/g;
    while ((m = fnRe.exec(src))) out.push(`${m[1]}(${m[2].trim()})`);
  }
  return out;
}

/**
 * Builds a compact API-surface block for the generator prompt. With mode 'api' it surfaces the
 * API lane (clients, contracts, the full current api fixtures file to merge, api step phrasings);
 * otherwise the UI lane (page objects, ui fixtures, ui steps). Empty string if nothing found.
 */
export function readProjectSurface(root = process.cwd(), mode: 'ui' | 'api' = 'ui'): string {
  const helpers = dataHelpers(root);
  const sections: string[] = [];
  if (helpers.length) sections.push(`Data helpers (src/fixtures/data.ts):\n- ${helpers.join('\n- ')}`);

  if (mode === 'api') {
    const clients = classesIn(root, ['src/api', 'src/api/clients']);
    const contracts = apiContracts(root);
    const apiStepList = steps(root, 'src/steps/api');
    const fixturesSrc = read(path.join(root, 'src/api/fixtures.ts'));

    if (clients.length) sections.push(`API clients (src/api, extend BaseApiClient):\n- ${clients.join('\n- ')}`);
    if (contracts.length) sections.push(`Response contracts (src/api/contracts):\n- ${contracts.join('\n- ')}`);
    if (apiStepList.length)
      sections.push(`Existing API step definitions (REUSE verbatim; do NOT redefine):\n- ${apiStepList.join('\n- ')}`);
    if (fixturesSrc.trim())
      sections.push(
        `Current src/api/fixtures.ts (return a FULL merged version in supportFiles if you add a ` +
          `client/state fixture — PRESERVE the existing entries):\n\n${fixturesSrc}`
      );
    return sections.join('\n\n');
  }

  const fix = fixtures(root);
  const pages = pageObjects(root);
  const stepList = steps(root);
  if (fix.length) sections.push(`Fixtures available to steps (destructure from the first arg):\n- ${fix.join('\n- ')}`);
  if (pages.length) sections.push(`Page objects (src/pages):\n- ${pages.join('\n- ')}`);
  if (stepList.length) sections.push(`Existing step definitions (REUSE verbatim; do NOT redefine):\n- ${stepList.join('\n- ')}`);

  return sections.join('\n\n');
}

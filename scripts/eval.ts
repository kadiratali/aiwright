/**
 * Quality scorecard for the aiwright pipeline.
 *
 *   npm run eval          deterministic + live-inspect checks (no LLM, cheap)
 *   npm run eval -- --full also exercises design + generation (LLM, costs API calls)
 *
 * Exits non-zero if any run check fails, so it can gate CI.
 */
import * as fs from 'fs';
import { redact, registerSecrets } from '../src/ai/redact';
import { readProjectSurface } from '../src/ai/projectSurface';
import { inspectPage } from '../src/ai/pageInspector';
import { designTests } from '../src/ai/testDesigner';
import { generateTests, writeArtifacts } from '../src/ai/testGenerator';
import { verifyTypeScript } from '../src/ai/verifier';
import { TARGET_URL } from '../src/config';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const add = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });

const GOLDEN_STORY = `Title: Customer login
As a registered customer I want to log in so that I can access my account.
Acceptance Criteria:
1. Valid credentials show the account menu.
2. A wrong password shows a login error.`;

function deterministic(): void {
  // 1) Redaction: masks PII patterns + denylist values, keeps benign numbers.
  registerSecrets(['Ahmet Yılmaz']);
  const masked =
    !redact('TCKN 12345678901').includes('12345678901') &&
    !redact('card 4111111111111111').includes('4111111111111111') &&
    !redact('name Ahmet Yılmaz').includes('Ahmet Yılmaz');
  const kept = redact('4 items, status 200').includes('4 items, status 200');
  add('redaction masks PII and keeps benign text', masked && kept);

  // 2) Project surface: discovers the real helpers, page objects, and steps.
  const surface = readProjectSurface();
  const surfaceOk = ['getUser', 'ToolshopLoginPage', 'the user is on the login page'].every((s) =>
    surface.includes(s)
  );
  add('project surface finds real helpers/pages/steps', surfaceOk);
}

async function liveInspect(): Promise<void> {
  try {
    const map = await inspectPage(`${TARGET_URL}/auth/login`);
    const unique = (s: string) => map.entries.some((e) => e.selector.includes(s) && e.count === 1);
    const ok = unique('email') && unique('password') && unique('login-submit');
    add('inspector finds unique login selectors (live)', ok, `${map.entries.length} elements`);
  } catch (e: any) {
    add('inspector finds unique login selectors (live)', false, e?.message ?? String(e));
  }
}

async function llm(): Promise<void> {
  // 3) Design produces structured, non-trivial output.
  const design = await designTests(GOLDEN_STORY);
  add(
    'design produces scenarios + risks',
    design.scenarios.length >= 3 && design.riskAreas.length >= 1,
    `${design.scenarios.length} scenarios, ${design.riskAreas.length} risks, ${design.openQuestions.length} questions`
  );

  // 4) Generation compiles against the real project (the wiring gap).
  const artifacts = await generateTests(GOLDEN_STORY);
  const written = writeArtifacts(artifacts);
  const tsFiles = written.map((w) => w.split(' ')[0]).filter((f) => f.endsWith('.ts'));
  const result = verifyTypeScript(tsFiles);
  add('generation compiles (tsc)', result.ok, result.ok ? '' : `${result.errors.length} type errors`);

  // Clean up the throwaway artifacts this check wrote.
  for (const entry of written) {
    const f = entry.split(' ')[0];
    for (const p of [f, `${f}.bak`, `${f}.generated`]) if (fs.existsSync(p)) fs.rmSync(p);
  }
}

async function main(): Promise<void> {
  const full = process.argv.includes('--full');
  deterministic();
  await liveInspect();
  if (full) await llm();

  const pad = Math.max(...checks.map((c) => c.name.length));
  console.log('\naiwright eval scorecard');
  console.log('━'.repeat(pad + 14));
  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'}  ${c.name.padEnd(pad)}  ${c.detail}`);
  }
  const passed = checks.filter((c) => c.ok).length;
  console.log('━'.repeat(pad + 14));
  console.log(`${passed}/${checks.length} passed${full ? '' : '  (run with --full for design + generation checks)'}\n`);

  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((err) => {
  console.error('eval failed:', err?.message ?? err);
  process.exit(1);
});

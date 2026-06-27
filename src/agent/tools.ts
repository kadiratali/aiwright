import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

import { request } from '@playwright/test';

import { designTests, writeDesignReport } from '../ai/testDesigner';
import { inspectPage, writeSelectorMap } from '../ai/pageInspector';
import { probeApi, writeEndpointMap } from '../ai/specProbe';
import { generateTests, correctArtifacts, writeArtifacts } from '../ai/testGenerator';
import { verifyTypeScript, runFeature } from '../ai/verifier';
import { extractFailures, analyzeFailures, writeAnalysisReport } from '../ai/failureAnalyzer';
import { repairSelectors, type SourceFile } from '../ai/selectorHealer';
import { repairContract } from '../ai/contractHealer';
import { config } from '../config';

import type { RunState, StepKind } from './state';

export type ToolName = StepKind;

/** Result of running one tool — `summary` is shown to the user and fed back to the model. */
export interface ToolResult {
  ok: boolean;
  summary: string;
  artifact?: string;
  /** Set when a human decision is needed (semantic gate, e.g. a real app regression). */
  escalate?: string;
}

/**
 * Tool schemas given to the model. Inputs are intentionally minimal: the heavy context
 * (story, design, selector map) lives in RunState, so the model's job is *sequencing*,
 * not regurgitating large text.
 */
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'design',
    description:
      'Turn the user story into a "what to test" plan: risk areas, prioritised scenario ideas, ' +
      'open questions, out-of-scope calls. Produces a review-only report, no code. Run first when scope is unclear.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'inspect',
    description:
      'Open the live page and extract a stability-ranked map of REAL, verified selectors from the DOM. ' +
      'Run before generate so the code uses real selectors instead of guesses. Provide the target URL or path.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Full URL or a path resolved against BASE_URL.' },
        login: { type: 'string', description: 'Optional user key to sign in first (e.g. "standard").' }
      },
      required: ['target'],
      additionalProperties: false
    }
  },
  {
    name: 'probe',
    description:
      'API analogue of inspect: parse an OpenAPI spec into a map of REAL, declared endpoints ' +
      '(methods, params, response schemas) and optionally verify each GET against the live API. ' +
      'Run before generating API tests so they target real endpoints/shapes, not guesses. ' +
      'specPath defaults to docs/api/openapi.json (JSON only).',
    input_schema: {
      type: 'object',
      properties: {
        specPath: { type: 'string', description: 'Path to a JSON OpenAPI spec (default docs/api/openapi.json).' },
        baseUrl: { type: 'string', description: 'Override base URL to probe (default: spec server / API_BASE_URL).' },
        live: { type: 'boolean', description: 'Also call the GET endpoints to verify them (default false).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'generate',
    description:
      'Generate the .feature file, step definitions and page objects (UI) — or, with api:true, an ' +
      '@api feature + API step definitions + client/contract files (API lane). Set ' +
      'useDesign/useSelectors/useEndpoints to ground generation in the design, selector map, or ' +
      'endpoint map already produced.',
    input_schema: {
      type: 'object',
      properties: {
        useDesign: { type: 'boolean', description: 'Scope generation to the approved design (if one exists).' },
        useSelectors: { type: 'boolean', description: 'UI: use the inspected selector map verbatim (if one exists).' },
        api: { type: 'boolean', description: 'Generate API-lane tests (APIRequestContext) instead of UI tests.' },
        useEndpoints: { type: 'boolean', description: 'API: use the probed endpoint map verbatim (implies api:true).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'verify',
    description: 'Type-check the generated code (tsc --noEmit). Always run after generate or heal. Read-only.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'heal',
    description:
      'Targeted self-correction: feed the current tsc errors back to the model and rewrite ONLY what is ' +
      'needed so the generated code compiles (merging new members into the existing page objects). ' +
      'Prefer this over regenerating from scratch when verify fails. Re-verifies automatically.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'run',
    description:
      'Execute the generated scenarios in a real browser and report the pass/fail tally. Run after verify passes. ' +
      'Set maxRetries to re-run failing scenarios and tell flaky (passes on retry) from a consistent failure.',
    input_schema: {
      type: 'object',
      properties: {
        maxRetries: { type: 'number', description: 'Re-runs on failure (0-3, default 1) for flaky detection.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'analyze',
    description:
      'Analyze the failures in the Cucumber report and categorise each (app-bug | test-bug | flaky | environment). ' +
      'Run after a failing run.',
    input_schema: {
      type: 'object',
      properties: {
        reportPath: { type: 'string', description: 'Defaults to reports/cucumber-report.json.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'heal-selectors',
    description:
      'Runtime selector self-heal: when a run failed because a locator did not resolve (timeout waiting for ' +
      'locator / strict-mode / not visible), re-inspect the page where that element lives and rewrite the ' +
      'failing selectors with real ones from the fresh map. Provide inspectUrl = the page the failing step is on ' +
      '(e.g. the results URL, or the base URL for header elements). Re-verifies (tsc); then re-run to confirm.',
    input_schema: {
      type: 'object',
      properties: {
        inspectUrl: {
          type: 'string',
          description: 'URL/path of the page where the failing element lives, to re-inspect for real selectors.'
        }
      },
      required: ['inspectUrl'],
      additionalProperties: false
    }
  },
  {
    name: 'heal-contract',
    description:
      'API analogue of heal-selectors: when an API run failed on schema drift (a thrown "Contract violation", ' +
      'a body-field assertion, or an unexpected status — NOT a locator), re-fetch the live response from the ' +
      'failing endpoint and rewrite the stale contract/assertions in the API suite (src/api, src/steps/api). ' +
      'Provide endpoint = the path (+query) to re-fetch, e.g. "/api/search?term=telefon". Re-verifies (tsc); ' +
      'then re-run to confirm. Use only for stale TEST expectations — a real API regression must be escalated.',
    input_schema: {
      type: 'object',
      properties: {
        endpoint: {
          type: 'string',
          description: 'Path (+query) of the failing endpoint to re-fetch live, e.g. /api/search?term=telefon.'
        },
        baseUrl: { type: 'string', description: 'Override base URL (default API_BASE_URL).' }
      },
      required: ['endpoint'],
      additionalProperties: false
    }
  }
];

interface InspectInput { target: string; login?: string }
interface ProbeInput { specPath?: string; baseUrl?: string; live?: boolean }
interface GenerateInput { useDesign?: boolean; useSelectors?: boolean; api?: boolean; useEndpoints?: boolean }
interface RunInput { maxRetries?: number }
interface AnalyzeInput { reportPath?: string }
interface HealSelectorsInput { inspectUrl?: string }
interface HealContractInput { endpoint?: string; baseUrl?: string }

const MAX_HEAL_ROUNDS = 3;
const MAX_SELECTOR_HEAL_ROUNDS = 3;
const MAX_CONTRACT_HEAL_ROUNDS = 3;

/** Repo-relative dirs the selector healer may read from and write back to. */
const HEAL_DIRS = ['src/pages', 'src/steps'];
/** Repo-relative dirs the contract healer may read from and write back to (the API suite). */
const API_HEAL_DIRS = ['src/api', 'src/steps/api'];

/** Recursively collects .ts sources under the given dirs (incl. subdirs), repo-relative. */
function collectSourceFiles(rootDir: string, dirs: string[]): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (rel: string) => {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(childRel);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.generated') && !entry.name.endsWith('.bak')) {
        out.push({ path: childRel, content: fs.readFileSync(path.join(rootDir, childRel), 'utf-8') });
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return out;
}

const collectPagesAndSteps = (rootDir: string): SourceFile[] => collectSourceFiles(rootDir, HEAL_DIRS);

/**
 * Writes a healer's corrected files back, preserving their relative path. Constrained to
 * `allowedDirs` (rejects anything that escapes), and backs up each original to .bak once so a
 * failed heal can be rolled back. Returns the absolute paths actually written.
 */
function writeRepairedFiles(files: SourceFile[], rootDir: string, allowedDirs: string[] = HEAL_DIRS): string[] {
  const written: string[] = [];
  for (const f of files) {
    const rel = path.normalize(f.path).replace(/^(\.\.(\/|\\|$))+/, '');
    const abs = path.resolve(rootDir, rel);
    const allowed = allowedDirs.some((d) => abs.startsWith(path.resolve(rootDir, d) + path.sep));
    if (!allowed) continue; // never write outside the allowed dirs
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (fs.existsSync(abs)) {
      const bak = `${abs}.bak`;
      if (!fs.existsSync(bak)) fs.copyFileSync(abs, bak);
    }
    fs.writeFileSync(abs, f.content);
    written.push(abs);
  }
  return written;
}

/** Reads the existing project sources `heal` may need to update (merging in new members). */
function collectSources(rootDir: string, mode: 'ui' | 'api' = 'ui'): { fileName: string; content: string }[] {
  if (mode === 'api') {
    // The API suite (clients, contracts, fixtures, steps) — keyed by repo-relative path.
    return collectSourceFiles(rootDir, API_HEAL_DIRS).map((f) => ({ fileName: f.path, content: f.content }));
  }
  const sources: { fileName: string; content: string }[] = [];
  for (const dir of ['src/pages', 'src/fixtures']) {
    const abs = path.join(rootDir, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.ts')) sources.push({ fileName: f, content: fs.readFileSync(path.join(abs, f), 'utf-8') });
    }
  }
  return sources;
}

const tscDetail = (errors: { file: string; line: number; message: string }[]): string =>
  errors.map((e) => `${path.basename(e.file)}:${e.line} ${e.message}`).join('; ');

/**
 * Removes the `.bak` rollback copies writeArtifacts left for the given written files.
 * Called once a heal succeeds: the backups exist only to undo a failed correction, so a
 * clean type-check makes them dead weight. Returns how many were removed.
 */
function removeBackups(written: string[], rootDir: string): number {
  let removed = 0;
  for (const w of written) {
    const target = path.isAbsolute(w.split(' ')[0])
      ? w.split(' ')[0]
      : path.join(rootDir, w.split(' ')[0]);
    const bak = `${target}.bak`;
    if (fs.existsSync(bak)) {
      fs.rmSync(bak);
      removed++;
    }
  }
  return removed;
}

const readIf = (p?: string): string | undefined =>
  p && fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : undefined;

/** Runs one tool against the existing ai/* modules, updating RunState in place. */
export async function executeTool(
  name: ToolName,
  input: unknown,
  state: RunState,
  rootDir = process.cwd()
): Promise<ToolResult> {
  switch (name) {
    case 'design': {
      const design = await designTests(state.story);
      const file = writeDesignReport(design, rootDir);
      state.designPath = file;
      return {
        ok: true,
        artifact: file,
        summary:
          `Design ready: ${design.scenarios.length} scenario idea(s), ${design.riskAreas.length} risk area(s), ` +
          `${design.openQuestions.length} open question(s). Report (for human review): ${file}`
      };
    }

    case 'inspect': {
      const { target, login } = input as InspectInput;
      if (!target) return { ok: false, summary: 'inspect requires a "target" URL or path.' };
      const map = await inspectPage(target, { loginUserKey: login });
      const file = writeSelectorMap(map, rootDir);
      state.selectorMapPath = file;
      const unique = map.entries.filter((e) => e.count === 1).length;
      const unresolved = map.entries.filter((e) => e.unresolved).length;
      return {
        ok: true,
        artifact: file,
        summary:
          `Inspected ${target}: ${map.entries.length} element(s), ${unique} unique selector(s)` +
          `${unresolved ? `, ${unresolved} unresolved` : ''}. Map: ${file}`
      };
    }

    case 'probe': {
      const { specPath, baseUrl, live } = (input as ProbeInput) ?? {};
      const map = await probeApi(specPath ?? config.openApiSpec, { baseUrl, live, rootDir });
      const file = writeEndpointMap(map, rootDir);
      state.endpointMapPath = file;
      const verified = map.endpoints.filter((e) => e.observed && e.observed.status > 0).length;
      const undeclared = map.endpoints.filter((e) => e.observed && !e.observed.declared && e.observed.status > 0).length;
      return {
        ok: true,
        artifact: file,
        summary:
          `Probed ${map.title}: ${map.endpoints.length} endpoint(s)` +
          `${live ? `, ${verified} verified live${undeclared ? `, ${undeclared} with an undeclared status` : ''}` : ' (spec only)'}. ` +
          `${map.warnings.length ? `Warnings: ${map.warnings.join('; ')}. ` : ''}Map: ${file}`
      };
    }

    case 'generate': {
      const g = (input as GenerateInput) ?? {};
      const apiMode = !!(g.api || g.useEndpoints);
      const mode: 'ui' | 'api' = apiMode ? 'api' : 'ui';
      const design = g.useDesign ? readIf(state.designPath) : undefined;
      const mapJson = apiMode
        ? g.useEndpoints
          ? readIf(state.endpointMapPath)
          : undefined
        : g.useSelectors
          ? readIf(state.selectorMapPath)
          : undefined;

      const artifacts = await generateTests(state.story, design, mapJson, undefined, mode);
      const written = writeArtifacts(artifacts, rootDir, { overwrite: true }, mode);

      // writeArtifacts may annotate paths (e.g. "foo.ts (overwritten)"); keep the path part.
      state.artifactFiles = written.map((w) => w.split(' ')[0]).filter((f) => f.endsWith('.ts'));
      state.lastArtifacts = artifacts; // base for `heal`
      state.lastGenMode = mode; // routes which lane `heal` corrects
      state.healRounds = 0; // fresh code — reset the healing budget
      state.healSelectorRounds = 0; // and the runtime selector-heal budget
      state.healContractRounds = 0; // and the runtime contract-heal budget
      state.lastFeatureTitle = (artifacts.featureContent.match(/Feature:\s*(.+)/) ?? [])[1]?.trim();

      const grounding = [
        g.useDesign && design ? 'design' : null,
        !apiMode && g.useSelectors && mapJson ? 'selectors' : null,
        apiMode && g.useEndpoints && mapJson ? 'endpoints' : null
      ]
        .filter(Boolean)
        .join(' + ');
      return {
        ok: true,
        summary:
          `Generated ${written.length} ${apiMode ? 'API ' : ''}file(s)${grounding ? ` (grounded in ${grounding})` : ''}: ` +
          `${written.join(', ')}. Run verify next.`
      };
    }

    case 'verify': {
      if (state.artifactFiles.length === 0) {
        return { ok: false, summary: 'Nothing to verify yet — run generate first.' };
      }
      const result = verifyTypeScript(state.artifactFiles, rootDir);
      if (result.ok) return { ok: true, summary: 'Generated code type-checks cleanly — ready to run.' };
      return {
        ok: false,
        summary: `${result.errors.length} type error(s): ${tscDetail(result.errors)}. Use heal to fix.`
      };
    }

    case 'heal': {
      if (!state.lastArtifacts || state.artifactFiles.length === 0) {
        return { ok: false, summary: 'Nothing to heal — run generate first.' };
      }
      if (state.healRounds >= MAX_HEAL_ROUNDS) {
        return {
          ok: false,
          summary: `Healing budget (${MAX_HEAL_ROUNDS} rounds) exhausted — the code still does not compile.`,
          escalate: 'Repeated self-correction failed to produce compiling code — a human should wire it.'
        };
      }
      const before = verifyTypeScript(state.artifactFiles, rootDir);
      if (before.ok) return { ok: true, summary: 'Already type-checks — nothing to heal.' };

      const mode = state.lastGenMode ?? 'ui';
      const mapJson = mode === 'api' ? readIf(state.endpointMapPath) : readIf(state.selectorMapPath);
      const corrected = await correctArtifacts(
        state.story,
        state.lastArtifacts,
        before.errors,
        collectSources(rootDir, mode),
        mapJson,
        mode
      );
      const written = writeArtifacts(corrected, rootDir, { overwrite: true }, mode);
      state.lastArtifacts = corrected;
      state.artifactFiles = written.map((w) => w.split(' ')[0]).filter((f) => f.endsWith('.ts'));
      state.healRounds++;

      const after = verifyTypeScript(state.artifactFiles, rootDir);
      if (after.ok) {
        // Code compiles → the rollback backups are no longer needed.
        const cleaned = removeBackups(written, rootDir);
        return {
          ok: true,
          summary:
            `Healed (round ${state.healRounds}/${MAX_HEAL_ROUNDS}): code now type-checks` +
            `${cleaned ? `; ${cleaned} backup(s) cleaned` : ''}.`
        };
      }
      return {
        ok: false,
        summary: `Round ${state.healRounds}/${MAX_HEAL_ROUNDS}: ${after.errors.length} error(s) remain: ${tscDetail(after.errors)}`
      };
    }

    case 'heal-selectors': {
      const { inspectUrl } = (input as HealSelectorsInput) ?? {};
      if (!inspectUrl) {
        return { ok: false, summary: 'heal-selectors requires "inspectUrl" — the page where the failing element lives.' };
      }
      if (!state.lastRunFailed || state.lastRunFailed === 0) {
        return { ok: false, summary: 'Nothing to heal — run the suite first; this fixes RUNTIME locator failures.' };
      }
      if (state.healSelectorRounds >= MAX_SELECTOR_HEAL_ROUNDS) {
        return {
          ok: false,
          summary: `Selector-heal budget (${MAX_SELECTOR_HEAL_ROUNDS} rounds) exhausted — selectors still fail at runtime.`,
          escalate: 'Repeated selector self-heal failed — a human should inspect the page and wire the selectors.'
        };
      }
      const reportPath = path.join(rootDir, 'reports', 'cucumber-report.json');
      if (!fs.existsSync(reportPath)) {
        return { ok: false, summary: `No report at ${reportPath} — run the suite first.` };
      }
      const failures = extractFailures(reportPath).map((f) => ({
        scenario: f.scenario,
        failedStep: f.failedStep,
        errorMessage: f.errorMessage
      }));
      if (failures.length === 0) {
        return { ok: false, summary: 'Report shows no failures — nothing to heal.' };
      }

      // Re-inspect the page where the failing element lives → fresh, real selectors.
      const map = await inspectPage(inspectUrl);
      state.selectorMapPath = writeSelectorMap(map, rootDir);

      const sources = collectPagesAndSteps(rootDir);
      const repair = await repairSelectors(state.story, failures, JSON.stringify(map, null, 2), sources);
      const written = writeRepairedFiles(repair.files, rootDir);
      if (written.length === 0) {
        return { ok: false, summary: `Healer proposed no in-scope file changes. Notes: ${repair.notes}` };
      }
      state.healSelectorRounds++;

      // Keep the patched files in the verify/run scope, then confirm they still type-check.
      const tsFiles = written.filter((f) => f.endsWith('.ts'));
      state.artifactFiles = [...new Set([...state.artifactFiles, ...tsFiles])];
      const after = verifyTypeScript(tsFiles, rootDir);
      if (!after.ok) {
        return {
          ok: false,
          summary:
            `Patched ${tsFiles.length} file(s) from ${inspectUrl} but tsc now fails: ${tscDetail(after.errors)}. ` +
            `Use heal, then re-run.`
        };
      }
      return {
        ok: true,
        summary:
          `Selector heal (round ${state.healSelectorRounds}/${MAX_SELECTOR_HEAL_ROUNDS}): re-inspected ${inspectUrl}, ` +
          `patched ${written.map((w) => path.basename(w)).join(', ')}; type-checks. Re-run to confirm.`
      };
    }

    case 'heal-contract': {
      const { endpoint, baseUrl } = (input as HealContractInput) ?? {};
      if (!endpoint) {
        return { ok: false, summary: 'heal-contract requires "endpoint" — the path (+query) of the failing API call.' };
      }
      if (!state.lastRunFailed || state.lastRunFailed === 0) {
        return { ok: false, summary: 'Nothing to heal — run the suite first; this fixes RUNTIME contract/schema drift.' };
      }
      if (state.healContractRounds >= MAX_CONTRACT_HEAL_ROUNDS) {
        return {
          ok: false,
          summary: `Contract-heal budget (${MAX_CONTRACT_HEAL_ROUNDS} rounds) exhausted — the contract still mismatches at runtime.`,
          escalate: 'Repeated contract self-heal failed — a human should inspect the API response and the expectations.'
        };
      }
      const reportPath = path.join(rootDir, 'reports', 'cucumber-report.json');
      if (!fs.existsSync(reportPath)) {
        return { ok: false, summary: `No report at ${reportPath} — run the suite first.` };
      }
      const failures = extractFailures(reportPath).map((f) => ({
        scenario: f.scenario,
        failedStep: f.failedStep,
        errorMessage: f.errorMessage
      }));
      if (failures.length === 0) {
        return { ok: false, summary: 'Report shows no failures — nothing to heal.' };
      }

      // Re-fetch the live response from the failing endpoint → the real, current shape.
      const apiBase = baseUrl ?? config.apiBaseUrl;
      let fresh: { url: string; status: number; body: unknown };
      const ctx = await request.newContext({ baseURL: apiBase });
      try {
        const res = await ctx.get(endpoint);
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = await res.text();
        }
        fresh = { url: `${apiBase}${endpoint}`, status: res.status(), body };
      } finally {
        await ctx.dispose();
      }

      const sources = collectSourceFiles(rootDir, API_HEAL_DIRS);
      const repair = await repairContract(state.story, failures, JSON.stringify(fresh, null, 2), sources);
      const written = writeRepairedFiles(repair.files, rootDir, API_HEAL_DIRS);
      if (written.length === 0) {
        return { ok: false, summary: `Healer proposed no in-scope file changes. Notes: ${repair.notes}` };
      }
      state.healContractRounds++;

      const tsFiles = written.filter((f) => f.endsWith('.ts'));
      state.artifactFiles = [...new Set([...state.artifactFiles, ...tsFiles])];
      const after = verifyTypeScript(tsFiles, rootDir);
      if (!after.ok) {
        return {
          ok: false,
          summary:
            `Patched ${tsFiles.length} file(s) from ${endpoint} (status ${fresh.status}) but tsc now fails: ` +
            `${tscDetail(after.errors)}. Use heal, then re-run.`
        };
      }
      return {
        ok: true,
        summary:
          `Contract heal (round ${state.healContractRounds}/${MAX_CONTRACT_HEAL_ROUNDS}): re-fetched ${endpoint} ` +
          `(status ${fresh.status}), patched ${written.map((w) => path.basename(w)).join(', ')}; type-checks. Re-run to confirm.`
      };
    }

    case 'run': {
      if (!state.lastFeatureTitle) {
        return { ok: false, summary: 'No generated feature to run — generate (and verify) first.' };
      }
      const { maxRetries } = (input as RunInput) ?? {};
      const retries = Math.max(0, Math.min(maxRetries ?? 1, 3));

      let last = runFeature(state.lastFeatureTitle, rootDir);
      for (let attempt = 1; !last.ok && attempt <= retries; attempt++) {
        const retry = runFeature(state.lastFeatureTitle, rootDir);
        if (retry.ok) {
          // Passed only after a re-run → flaky, not a real regression.
          state.lastRunPassed = retry.passed;
          state.lastRunFailed = 0;
          return {
            ok: true,
            summary: `${retry.passed} scenario(s) passed, but only after ${attempt} retr${attempt > 1 ? 'ies' : 'y'} — FLAKY. Worth stabilising.`
          };
        }
        last = retry;
      }
      state.lastRunPassed = last.passed;
      state.lastRunFailed = last.failed;
      return last.ok
        ? { ok: true, summary: `${last.passed} scenario(s) passed.` }
        : {
            ok: false,
            summary:
              `${last.passed} passed, ${last.failed} failed after ${retries} retr${retries === 1 ? 'y' : 'ies'} ` +
              `— consistent failure. Run analyze. Traces: reports/test-results.`
          };
    }

    case 'analyze': {
      const { reportPath } = (input as AnalyzeInput) ?? {};
      const report = reportPath ?? path.join('reports', 'cucumber-report.json');
      if (!fs.existsSync(report)) {
        return { ok: false, summary: `No report at ${report} — run the suite first.` };
      }
      const failures = extractFailures(report);
      if (failures.length === 0) {
        // Stale-report trap: if the last run reported failures but the report shows none,
        // the report is out of date / from another run — do NOT declare all-green.
        if (state.lastRunFailed && state.lastRunFailed > 0) {
          return {
            ok: false,
            summary:
              `Report at ${report} shows no failures, but the last run reported ${state.lastRunFailed} ` +
              `failed. The report is stale or points at the wrong file — re-run, then analyze.`,
            escalate: `Run/report mismatch: ${state.lastRunFailed} failure(s) cannot be triaged because ${report} is stale.`
          };
        }
        return { ok: true, summary: 'No failed scenarios — nothing to analyze.' };
      }
      const result = await analyzeFailures(failures);
      const file = writeAnalysisReport(result, rootDir);
      const cats = result.analyses.map((a) => `${a.scenario} → ${a.category}`).join('; ');

      // Semantic gate: a real app bug is a regression in the product, not a test to "fix".
      // Healing it green would fake a passing test for behaviour the app does not have.
      const appBugs = result.analyses.filter((a) => a.category === 'app-bug');
      const escalate = appBugs.length
        ? `${appBugs.length} failure(s) look like REAL app bugs (regressions): ` +
          `${appBugs.map((a) => a.scenario).join(', ')}. Do NOT heal these to force green — a human must triage.`
        : undefined;

      return { ok: true, artifact: file, summary: `${result.summary} [${cats}]. Report: ${file}`, escalate };
    }

    default:
      return { ok: false, summary: `Unknown tool: ${name}` };
  }
}

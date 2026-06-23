import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

import { designTests, writeDesignReport } from '../ai/testDesigner';
import { inspectPage, writeSelectorMap } from '../ai/pageInspector';
import { generateTests, correctArtifacts, writeArtifacts } from '../ai/testGenerator';
import { verifyTypeScript, runFeature } from '../ai/verifier';
import { extractFailures, analyzeFailures, writeAnalysisReport } from '../ai/failureAnalyzer';

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
    name: 'generate',
    description:
      'Generate the .feature file, step definitions and page objects from the story. ' +
      'Set useDesign/useSelectors to true to ground generation in the design and selector map already produced.',
    input_schema: {
      type: 'object',
      properties: {
        useDesign: { type: 'boolean', description: 'Scope generation to the approved design (if one exists).' },
        useSelectors: { type: 'boolean', description: 'Use the inspected selector map verbatim (if one exists).' }
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
  }
];

interface InspectInput { target: string; login?: string }
interface GenerateInput { useDesign?: boolean; useSelectors?: boolean }
interface RunInput { maxRetries?: number }
interface AnalyzeInput { reportPath?: string }

const MAX_HEAL_ROUNDS = 3;

/** Reads the existing project sources `heal` may need to update (merging in new members). */
function collectSources(rootDir: string): { fileName: string; content: string }[] {
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

    case 'generate': {
      const { useDesign, useSelectors } = (input as GenerateInput) ?? {};
      const design = useDesign ? readIf(state.designPath) : undefined;
      const selectors = useSelectors ? readIf(state.selectorMapPath) : undefined;

      const artifacts = await generateTests(state.story, design, selectors);
      const written = writeArtifacts(artifacts, rootDir, { overwrite: true });

      // writeArtifacts may annotate paths (e.g. "foo.ts (overwritten)"); keep the path part.
      state.artifactFiles = written.map((w) => w.split(' ')[0]).filter((f) => f.endsWith('.ts'));
      state.lastArtifacts = artifacts; // base for `heal`
      state.healRounds = 0; // fresh code — reset the healing budget
      state.lastFeatureTitle = (artifacts.featureContent.match(/Feature:\s*(.+)/) ?? [])[1]?.trim();

      const grounding = [useDesign && design ? 'design' : null, useSelectors && selectors ? 'selectors' : null]
        .filter(Boolean)
        .join(' + ');
      return {
        ok: true,
        summary:
          `Generated ${written.length} file(s)${grounding ? ` (grounded in ${grounding})` : ''}: ` +
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

      const selectors = readIf(state.selectorMapPath);
      const corrected = await correctArtifacts(
        state.story,
        state.lastArtifacts,
        before.errors,
        collectSources(rootDir),
        selectors
      );
      const written = writeArtifacts(corrected, rootDir, { overwrite: true });
      state.lastArtifacts = corrected;
      state.artifactFiles = written.map((w) => w.split(' ')[0]).filter((f) => f.endsWith('.ts'));
      state.healRounds++;

      const after = verifyTypeScript(state.artifactFiles, rootDir);
      if (after.ok) {
        return { ok: true, summary: `Healed (round ${state.healRounds}/${MAX_HEAL_ROUNDS}): code now type-checks.` };
      }
      return {
        ok: false,
        summary: `Round ${state.healRounds}/${MAX_HEAL_ROUNDS}: ${after.errors.length} error(s) remain: ${tscDetail(after.errors)}`
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

import * as fs from 'fs';
import * as path from 'path';
import { generateTests, writeArtifacts, correctArtifacts } from '../ai/testGenerator';
import { designTests, writeDesignReport, capScenarios } from '../ai/testDesigner';
import { inspectPage, writeSelectorMap } from '../ai/pageInspector';
import { probeApi, writeEndpointMap } from '../ai/specProbe';
import { config } from '../config';
import { verifyTypeScript, runFeature } from '../ai/verifier';
import { extractFailures, analyzeFailures, writeAnalysisReport } from '../ai/failureAnalyzer';
import { runAgent } from '../agent/orchestrator';

const USAGE = `
AI QA Agent CLI

Usage:
  npm run ai:agent -- <user-story.txt | "user story text"> [--auto]
      Runs the orchestrator: from the story, the agent plans and sequences the
      tools (design -> inspect -> generate -> verify -> run -> analyze) on its own,
      pausing for a human OK before side-effecting steps (inspect/generate/run).
      With --auto, confirmation gates are skipped (non-interactive / CI).

  npm run ai:design -- <user-story.txt | "user story text"> [--max <N>]
      Produces a "what to test" design from a user story: risk areas, scenario
      ideas, open questions, out-of-scope calls. Generates no code - for a human to review.
      With --max <N>, a quick trial: only the N highest-priority scenarios are kept.

  npm run ai:inspect -- <url|path> [--login <userKey>]
      Opens the real page and extracts a stability-ranked selector map from the
      live DOM (data-test > stable id > role+name > text). With --login, signs in
      first via the project's LoginPage. Output: reports/selector-map-<slug>.json.

  npm run ai:probe -- [spec.json] [--base <url>] [--live]
      API analogue of ai:inspect. Parses a JSON OpenAPI spec (default docs/api/openapi.json)
      into a map of real, declared endpoints (methods, params, response schemas). With --live,
      also calls each GET endpoint to verify it against the running API. With --base, overrides
      the probed base URL. Output: reports/endpoint-map-<slug>.json.

  npm run ai:generate -- <user-story.txt | "user story text">
                        [--design <test-design.md>] [--selectors <selector-map.json>] [--max <N>]
      Generates feature + step definitions + page objects from a user story.
      With --max <N> (and no --design), a quick trial: at most N scenarios are
      generated, so a first run is small and fast.
      With --design, only the scenarios in the human-approved design are generated
      (authoritative scope; no invented scenarios, no dropped ones).
      With --selectors, real selectors from an ai:inspect map are used verbatim
      instead of guessed/placeholder ones.
      With --api (or --endpoints <endpoint-map.json>), generates API-lane tests instead:
      an @api .feature, API step definitions, and client/contract files under src/api,
      grounded in a probed endpoint map (--endpoints) when supplied.
      With --verify, runs tsc on the generated code and reports whether it
      compiles (and exactly what wiring is missing if not).
      With --fix, also feeds any compile errors back to the model to
      self-correct (up to 2 rounds), merging new members into the existing
      page objects (original backed up as .bak).
      With --run, once the code compiles, runs the generated scenarios and
      reports how many passed/failed (closes the pass loop, not just compile).

  npm run ai:analyze [-- <report-path>]
      Analyzes the failures in the Cucumber JSON report.
      Default report: reports/cucumber-report.json
`;

/** Parses an optional `--max <N>` flag (quick-trial scenario cap) out of args, in place. */
function takeMaxFlag(args: string[]): number | undefined {
  const i = args.indexOf('--max');
  if (i === -1) return undefined;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error('Error: --max needs a positive integer (e.g. --max 2).\n' + USAGE);
    process.exit(1);
  }
  args.splice(i, 2);
  return n;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'agent': {
      const args = [...rest];
      const ai = args.indexOf('--auto');
      const auto = ai !== -1;
      if (auto) args.splice(ai, 1);

      const input = args.join(' ').trim();
      if (!input) {
        console.error('Error: provide a user story file or text.\n' + USAGE);
        process.exit(1);
      }
      const story = fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : input;

      console.log(`Starting QA agent${auto ? ' (--auto: no confirmation gates)' : ''}...`);
      await runAgent('Build and verify a reviewed BDD test suite for the given user story.', story, process.cwd(), {
        auto
      });
      break;
    }

    case 'design': {
      const args = [...rest];
      const maxScenarios = takeMaxFlag(args);
      const input = args.join(' ').trim();
      if (!input) {
        console.error('Error: provide a user story file or text.\n' + USAGE);
        process.exit(1);
      }
      const story = fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : input;

      console.log(
        `Processing user story, producing test design${maxScenarios ? ` (quick: ≤${maxScenarios} scenarios)` : ''}...`
      );
      let design = await designTests(story, maxScenarios);
      if (maxScenarios) design = capScenarios(design, maxScenarios);
      const reportFile = writeDesignReport(design);

      console.log(`\n${design.title}`);
      console.log(`  Risk areas     : ${design.riskAreas.length}`);
      console.log(`  Scenario ideas : ${design.scenarios.length}`);
      console.log(`  Open questions : ${design.openQuestions.length}`);
      console.log(`  Out of scope   : ${design.outOfScope.length}`);
      console.log(`\nDesign report: ${reportFile}`);
      console.log('Review/edit it, then: npm run ai:generate -- <story> --design <report>');
      break;
    }

    case 'inspect': {
      const args = [...rest];
      let loginUserKey: string | undefined;
      const li = args.indexOf('--login');
      if (li !== -1) {
        loginUserKey = args[li + 1];
        if (!loginUserKey) {
          console.error('Error: provide a user key for --login (e.g. standard).\n' + USAGE);
          process.exit(1);
        }
        args.splice(li, 2);
      }

      const target = args.join(' ').trim();
      if (!target) {
        console.error('Error: provide a URL or path to inspect.\n' + USAGE);
        process.exit(1);
      }

      console.log(`Inspecting ${target}${loginUserKey ? ` (logged in as "${loginUserKey}")` : ''}...`);
      const map = await inspectPage(target, { loginUserKey });
      const mapFile = writeSelectorMap(map);

      const unique = map.entries.filter((e) => e.count === 1).length;
      const repeated = map.entries.filter((e) => e.repeats).length;
      const ambiguous = map.entries.filter((e) => e.ambiguous && !e.repeats).length;
      const unresolved = map.entries.filter((e) => e.unresolved).length;
      console.log(`\n${map.title}`);
      console.log(`  Elements found    : ${map.entries.length}`);
      console.log(`  Unique selectors  : ${unique}`);
      console.log(`  Repeated (lists)  : ${repeated}  (parametrize per item)`);
      console.log(`  Needs disambig.   : ${ambiguous}`);
      console.log(`  Unresolved (0 hit): ${unresolved}`);
      for (const w of map.warnings) console.log(`  ! ${w}`);
      console.log(`\nSelector map: ${mapFile}`);
      console.log('Review it, then: npm run ai:generate -- <story> --selectors ' + mapFile);
      break;
    }

    case 'probe': {
      const args = [...rest];
      const takeBool = (flag: string): boolean => {
        const i = args.indexOf(flag);
        if (i === -1) return false;
        args.splice(i, 1);
        return true;
      };
      let baseUrl: string | undefined;
      const bi = args.indexOf('--base');
      if (bi !== -1) {
        baseUrl = args[bi + 1];
        if (!baseUrl) {
          console.error('Error: provide a URL for --base.\n' + USAGE);
          process.exit(1);
        }
        args.splice(bi, 2);
      }
      const live = takeBool('--live');
      const specPath = args.join(' ').trim() || config.openApiSpec;

      console.log(`Probing ${specPath}${live ? ` (live against ${baseUrl ?? 'the spec server'})` : ' (spec only)'}...`);
      const map = await probeApi(specPath, { baseUrl, live });
      const mapFile = writeEndpointMap(map);

      console.log(`\n${map.title} ${map.version ?? ''}`.trim());
      console.log(`  Base URL        : ${map.baseUrl}`);
      console.log(`  Endpoints       : ${map.endpoints.length}`);
      if (live) {
        const verified = map.endpoints.filter((e) => e.observed && e.observed.status > 0).length;
        const undeclared = map.endpoints.filter((e) => e.observed && !e.observed.declared && e.observed.status > 0).length;
        console.log(`  Verified live   : ${verified}`);
        console.log(`  Undeclared stat.: ${undeclared}`);
      }
      for (const w of map.warnings) console.log(`  ! ${w}`);
      console.log(`\nEndpoint map: ${mapFile}`);
      break;
    }

    case 'generate': {
      // Extract the --design / --selectors <path> flags from the story input
      const args = [...rest];
      const takeFlag = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        if (i === -1) return undefined;
        const value = args[i + 1];
        if (!value) {
          console.error(`Error: provide a file path for ${flag}.\n` + USAGE);
          process.exit(1);
        }
        args.splice(i, 2);
        return value;
      };
      const takeBool = (flag: string): boolean => {
        const i = args.indexOf(flag);
        if (i === -1) return false;
        args.splice(i, 1);
        return true;
      };
      const maxScenarios = takeMaxFlag(args);
      const designPath = takeFlag('--design');
      const selectorsPath = takeFlag('--selectors');
      const endpointsPath = takeFlag('--endpoints');
      const apiFlag = takeBool('--api');
      const fix = takeBool('--fix');
      const run = takeBool('--run');
      const verify = takeBool('--verify') || fix || run;

      // API mode when --api is set or an endpoint map is supplied.
      const apiMode = apiFlag || !!endpointsPath;
      const mode: 'ui' | 'api' = apiMode ? 'api' : 'ui';

      const input = args.join(' ').trim();
      if (!input) {
        console.error('Error: provide a user story file or text.\n' + USAGE);
        process.exit(1);
      }
      const story = fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : input;

      let design: string | undefined;
      if (designPath) {
        if (!fs.existsSync(designPath)) {
          console.error(`Error: design file not found: ${designPath}`);
          process.exit(1);
        }
        design = fs.readFileSync(designPath, 'utf-8');
        console.log(`Using approved design: ${designPath}`);
      }

      // The grounding map: selector map (UI) or endpoint map (API).
      let mapJson: string | undefined;
      const mapPath = apiMode ? endpointsPath : selectorsPath;
      if (mapPath) {
        if (!fs.existsSync(mapPath)) {
          console.error(`Error: ${apiMode ? 'endpoint' : 'selector'} map not found: ${mapPath}`);
          process.exit(1);
        }
        mapJson = fs.readFileSync(mapPath, 'utf-8');
        console.log(`Using ${apiMode ? 'endpoint' : 'selector'} map: ${mapPath}`);
      }

      console.log(
        `Processing user story, generating ${apiMode ? 'API ' : ''}test artifacts${maxScenarios && !design ? ` (quick: ≤${maxScenarios} scenarios)` : ''}...`
      );
      let artifacts = await generateTests(story, design, mapJson, maxScenarios, mode);
      let written = writeArtifacts(artifacts, process.cwd(), {}, mode);

      console.log('\nFiles created:');
      for (const f of written) console.log(`  - ${f}`);
      console.log(`\nNotes:\n${artifacts.notes}`);

      if (verify) {
        const scopeFiles = (w: string[]) => w.map((f) => f.split(' ')[0]).filter((f) => f.endsWith('.ts'));
        console.log('\nVerifying generated code (tsc)...');
        let result = verifyTypeScript(scopeFiles(written));

        let round = 0;
        const MAX_ROUNDS = 2;
        while (!result.ok && fix && round < MAX_ROUNDS) {
          round++;
          console.log(`✗ ${result.errors.length} error(s); self-correcting (round ${round}/${MAX_ROUNDS})...`);
          // Give the model the current source of the project files it must update —
          // the API suite (recursive) in API mode, the UI page/fixture files otherwise.
          const sources: { fileName: string; content: string }[] = [];
          const collect = (rel: string) => {
            const abs = path.join(process.cwd(), rel);
            if (!fs.existsSync(abs)) return;
            for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
              const childRel = path.join(rel, entry.name);
              if (entry.isDirectory()) collect(childRel);
              else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.generated') && !entry.name.endsWith('.bak')) {
                sources.push({ fileName: childRel, content: fs.readFileSync(path.join(process.cwd(), childRel), 'utf-8') });
              }
            }
          };
          for (const dir of apiMode ? ['src/api', 'src/steps/api'] : ['src/pages', 'src/fixtures']) collect(dir);

          artifacts = await correctArtifacts(story, artifacts, result.errors, sources, mapJson, mode);
          written = writeArtifacts(artifacts, process.cwd(), { overwrite: true }, mode);
          result = verifyTypeScript(scopeFiles(written));
        }

        if (result.ok) {
          console.log(`✓ Generated code type-checks${round ? ` (after ${round} fix round(s))` : ''} — ready to run.`);
        } else {
          console.log(`✗ ${result.errors.length} type error(s) remain — wiring needed before this runs:`);
          for (const e of result.errors) {
            console.log(`   ${path.basename(e.file)}:${e.line}  ${e.message}`);
          }
          if (!fix) console.log('   Re-run with --fix to attempt automatic correction.');
        }

        if (run && result.ok) {
          const title = (artifacts.featureContent.match(/Feature:\s*(.+)/) ?? [])[1]?.trim();
          if (title) {
            console.log(`\nRunning the generated scenarios ("${title}")...`);
            const r = runFeature(title);
            if (r.ok) console.log(`✓ ${r.passed} scenario(s) passed.`);
            else console.log(`✗ ${r.passed} passed, ${r.failed} failed — see the trace under reports/test-results.`);
          }
        } else if (run) {
          console.log('   Skipping the test run — code does not compile yet.');
        }
      }

      console.log('\nTo run: npm test');
      break;
    }

    case 'analyze': {
      const reportPath = rest[0] ?? path.join('reports', 'cucumber-report.json');
      if (!fs.existsSync(reportPath)) {
        console.error(`Error: report not found: ${reportPath}. Run "npm test" first.`);
        process.exit(1);
      }

      const failures = extractFailures(reportPath);
      if (failures.length === 0) {
        console.log('No failed scenarios - nothing to analyze. ✅');
        return;
      }

      console.log(`Analyzing ${failures.length} failed scenario(s)...`);
      const result = await analyzeFailures(failures);
      const reportFile = writeAnalysisReport(result);

      console.log(`\nSummary: ${result.summary}\n`);
      for (const a of result.analyses) {
        console.log(`  [${a.category}] ${a.scenario}`);
        console.log(`     Root cause : ${a.rootCause}`);
        console.log(`     Fix        : ${a.suggestedFix}\n`);
      }
      console.log(`Detailed report: ${reportFile}`);
      break;
    }

    default:
      console.log(USAGE);
  }
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});

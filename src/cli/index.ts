import * as fs from 'fs';
import * as path from 'path';
import { generateTests, writeArtifacts, correctArtifacts } from '../ai/testGenerator';
import { designTests, writeDesignReport } from '../ai/testDesigner';
import { inspectPage, writeSelectorMap } from '../ai/pageInspector';
import { verifyTypeScript } from '../ai/verifier';
import { extractFailures, analyzeFailures, writeAnalysisReport } from '../ai/failureAnalyzer';

const USAGE = `
AI QA Agent CLI

Usage:
  npm run ai:design -- <user-story.txt | "user story text">
      Produces a "what to test" design from a user story: risk areas, scenario
      ideas, open questions, out-of-scope calls. Generates no code - for a human to review.

  npm run ai:inspect -- <url|path> [--login <userKey>]
      Opens the real page and extracts a stability-ranked selector map from the
      live DOM (data-test > stable id > role+name > text). With --login, signs in
      first via the project's LoginPage. Output: reports/selector-map-<slug>.json.

  npm run ai:generate -- <user-story.txt | "user story text">
                        [--design <test-design.md>] [--selectors <selector-map.json>]
      Generates feature + step definitions + page objects from a user story.
      With --design, only the scenarios in the human-approved design are generated
      (authoritative scope; no invented scenarios, no dropped ones).
      With --selectors, real selectors from an ai:inspect map are used verbatim
      instead of guessed/placeholder ones.
      With --verify, runs tsc on the generated code and reports whether it
      compiles (and exactly what wiring is missing if not).
      With --fix, also feeds any compile errors back to the model to
      self-correct (up to 2 rounds), merging new members into the existing
      page objects (original backed up as .bak).

  npm run ai:analyze [-- <report-path>]
      Analyzes the failures in the Cucumber JSON report.
      Default report: reports/cucumber-report.json
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'design': {
      const input = rest.join(' ').trim();
      if (!input) {
        console.error('Error: provide a user story file or text.\n' + USAGE);
        process.exit(1);
      }
      const story = fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : input;

      console.log('Processing user story, producing test design...');
      const design = await designTests(story);
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
      const designPath = takeFlag('--design');
      const selectorsPath = takeFlag('--selectors');
      const fix = takeBool('--fix');
      const verify = takeBool('--verify') || fix;

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

      let selectors: string | undefined;
      if (selectorsPath) {
        if (!fs.existsSync(selectorsPath)) {
          console.error(`Error: selector map not found: ${selectorsPath}`);
          process.exit(1);
        }
        selectors = fs.readFileSync(selectorsPath, 'utf-8');
        console.log(`Using selector map: ${selectorsPath}`);
      }

      console.log('Processing user story, generating test artifacts...');
      let artifacts = await generateTests(story, design, selectors);
      let written = writeArtifacts(artifacts);

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
          // Give the model the current source of the project files it must update.
          const sources: { fileName: string; content: string }[] = [];
          for (const dir of ['src/pages', 'src/fixtures']) {
            const abs = path.join(process.cwd(), dir);
            if (!fs.existsSync(abs)) continue;
            for (const f of fs.readdirSync(abs)) {
              if (f.endsWith('.ts') && !f.endsWith('.generated')) {
                sources.push({ fileName: f, content: fs.readFileSync(path.join(abs, f), 'utf-8') });
              }
            }
          }
          artifacts = await correctArtifacts(story, artifacts, result.errors, sources, selectors);
          written = writeArtifacts(artifacts, process.cwd(), { overwrite: true });
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

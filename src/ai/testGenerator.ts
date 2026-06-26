import * as fs from 'fs';
import * as path from 'path';
import { getClient, MODEL } from './client';
import {
  GENERATOR_SYSTEM,
  API_GENERATOR_SYSTEM,
  DESIGN_SCOPED_INSTRUCTION,
  SELECTORS_INSTRUCTION,
  ENDPOINTS_INSTRUCTION,
  PROJECT_SURFACE_INSTRUCTION,
  CORRECTION_INSTRUCTION,
  API_CORRECTION_NOTE
} from './prompts';
import type { TscError } from './verifier';
import { redact } from './redact';
import { registerAllSensitive } from '../fixtures/data';
import { readProjectSurface } from './projectSurface';

/** UI lane writes page objects to src/pages; API lane writes clients/contracts under src/api. */
export type GenMode = 'ui' | 'api';

export interface GeneratedArtifacts {
  featureFileName: string;
  featureContent: string;
  stepsFileName: string;
  stepsContent: string;
  /** UI lane: new page objects for src/pages (empty in API mode). */
  pageObjects: { fileName: string; content: string }[];
  /** API lane: client/contract/fixture files, each a repo-relative path under src/api. */
  supportFiles?: { path: string; content: string }[];
  notes: string;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    featureFileName: {
      type: 'string',
      description: 'File name only, e.g. checkout.feature'
    },
    featureContent: { type: 'string', description: 'Full Gherkin feature file content' },
    stepsFileName: {
      type: 'string',
      description: 'File name only, e.g. checkout.steps.ts'
    },
    stepsContent: { type: 'string', description: 'Full TypeScript step definitions file' },
    pageObjects: {
      type: 'array',
      description: 'UI lane only: new Page Object files for src/pages (empty in API mode)',
      items: {
        type: 'object',
        properties: {
          fileName: { type: 'string', description: 'e.g. CheckoutPage.ts' },
          content: { type: 'string' }
        },
        required: ['fileName', 'content'],
        additionalProperties: false
      }
    },
    supportFiles: {
      type: 'array',
      description:
        'API lane only: client/contract/fixture files, each with a repo-relative path under src/api ' +
        '(e.g. src/api/clients/ProductApi.ts, src/api/contracts/product.ts, src/api/fixtures.ts).',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path under src/api, e.g. src/api/clients/ProductApi.ts' },
          content: { type: 'string', description: 'Complete file content (not a diff)' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    },
    notes: {
      type: 'string',
      description: 'Assumptions made, placeholders to verify, suggested next steps'
    }
  },
  required: ['featureFileName', 'featureContent', 'stepsFileName', 'stepsContent', 'pageObjects', 'notes'],
  additionalProperties: false
} as const;

export async function generateTests(
  userStory: string,
  approvedDesign?: string,
  mapJson?: string,
  maxScenarios?: number,
  mode: GenMode = 'ui'
): Promise<GeneratedArtifacts> {
  // Before going to the LLM: load known secret values + redact the story (and the
  // human-edited design / selector|endpoint map, if any).
  registerAllSensitive();
  const safeStory = redact(userStory);
  const api = mode === 'api';

  let content = `Generate the ${api ? 'API ' : ''}BDD test artifacts for this user story:\n\n${safeStory}`;

  // Ground generation in the project's real API surface so it reuses existing
  // helpers/methods/steps instead of inventing them (the "wiring gap").
  const surface = readProjectSurface(process.cwd(), mode);
  if (surface) content += `\n\n${PROJECT_SURFACE_INSTRUCTION}\n\nPROJECT API SURFACE:\n\n${surface}`;

  if (approvedDesign?.trim()) {
    const safeDesign = redact(approvedDesign);
    content += `\n\n${DESIGN_SCOPED_INSTRUCTION}\n\nAPPROVED TEST DESIGN:\n\n${safeDesign}`;
  }
  if (mapJson?.trim()) {
    const safeMap = redact(mapJson);
    content += api
      ? `\n\n${ENDPOINTS_INSTRUCTION}\n\nENDPOINT MAP:\n\n${safeMap}`
      : `\n\n${SELECTORS_INSTRUCTION}\n\nSELECTOR MAP:\n\n${safeMap}`;
  }

  // Quick-trial cap. Applies whether or not a design is supplied: a curated design can list
  // many scenarios (15+), and implementing all of them is a huge, slow generation — so with
  // --max we restrict to the design's top-priority scenarios for a fast trial run.
  if (maxScenarios && maxScenarios > 0) {
    content += approvedDesign?.trim()
      ? `\n\nQUICK TRIAL (overrides the "implement every listed scenario" rule for this run): ` +
        `from the approved design, implement ONLY the ${maxScenarios} highest-priority scenario(s) ` +
        `(P0 first, then P1) and ignore the rest. Keep it minimal so the run is fast.`
      : `\n\nQUICK TRIAL: generate AT MOST ${maxScenarios} scenario(s) — the highest-value ones ` +
        `(core happy path first, then the most important negative case). Keep it minimal so the run is fast.`;
  }

  return runGenerator(content, api ? API_GENERATOR_SYSTEM : GENERATOR_SYSTEM);
}

/** Streams a generation request with the artifact JSON schema and parses the result. */
async function runGenerator(content: string, system: string = GENERATOR_SYSTEM): Promise<GeneratedArtifacts> {
  const client = getClient();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    // Thinking disabled for generation. With adaptive thinking on (even at low effort),
    // the model spent minutes thinking and consumed the whole 64k budget before emitting
    // any JSON. Disabled = straight to the structured answer: fast and predictable.
    thinking: { type: 'disabled' },
    system,
    output_config: {
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA }
    },
    messages: [{ role: 'user', content }]
  });

  stream.on('text', () => process.stdout.write('.'));
  const message = await stream.finalMessage();
  process.stdout.write('\n');

  if (message.stop_reason === 'refusal') {
    throw new Error('The model refused the request (stop_reason: refusal).');
  }

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    if (message.stop_reason === 'max_tokens') {
      throw new Error(
        'Hit max_tokens before any answer was emitted — the thinking budget consumed the whole ' +
          'response. Lower output_config.effort or reduce scope (fewer scenarios via --max).'
      );
    }
    throw new Error('No text response received from the model.');
  }
  return JSON.parse(textBlock.text) as GeneratedArtifacts;
}

/**
 * Self-correction step: given tsc errors and the current source of the existing project
 * files, asks the model to return corrected artifacts that compile (merging new members
 * into the full page-object files so they can replace the originals).
 */
export async function correctArtifacts(
  userStory: string,
  artifacts: GeneratedArtifacts,
  errors: TscError[],
  existingSources: { fileName: string; content: string }[],
  mapJson?: string,
  mode: GenMode = 'ui'
): Promise<GeneratedArtifacts> {
  registerAllSensitive();
  const api = mode === 'api';
  const errorText = errors.map((e) => `${path.basename(e.file)}:${e.line}  ${e.message}`).join('\n');
  const sourcesText = existingSources.map((s) => `// ${s.fileName}\n${s.content}`).join('\n\n');

  let content =
    `${CORRECTION_INSTRUCTION}${api ? `\n${API_CORRECTION_NOTE}` : ''}\n\nUSER STORY:\n\n${redact(userStory)}\n\n` +
    `CURRENT ARTIFACTS (JSON):\n\n${redact(JSON.stringify(artifacts, null, 2))}\n\n` +
    `TYPESCRIPT ERRORS:\n\n${errorText}\n\n` +
    `EXISTING PROJECT SOURCES (return full updated files to replace these):\n\n${redact(sourcesText)}`;

  const surface = readProjectSurface(process.cwd(), mode);
  if (surface) content += `\n\n${PROJECT_SURFACE_INSTRUCTION}\n\nPROJECT API SURFACE:\n\n${surface}`;
  if (mapJson?.trim()) {
    content += api
      ? `\n\n${ENDPOINTS_INSTRUCTION}\n\nENDPOINT MAP:\n\n${redact(mapJson)}`
      : `\n\n${SELECTORS_INSTRUCTION}\n\nSELECTOR MAP:\n\n${redact(mapJson)}`;
  }

  return runGenerator(content, api ? API_GENERATOR_SYSTEM : GENERATOR_SYSTEM);
}

export function writeArtifacts(
  artifacts: GeneratedArtifacts,
  rootDir = process.cwd(),
  opts: { overwrite?: boolean } = {},
  mode: GenMode = 'ui'
): string[] {
  const written: string[] = [];

  // Writes `content` to an absolute target with the project's backup/overwrite policy.
  const writeTo = (target: string, content: string) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const exists = fs.existsSync(target);
    if (exists && !opts.overwrite) {
      const backup = `${target}.generated`;
      fs.writeFileSync(backup, content);
      written.push(`${backup} (existing file was not overwritten)`);
      return;
    }
    if (exists && opts.overwrite) {
      // Back up the original once before the self-correction loop replaces it.
      const bak = `${target}.bak`;
      if (!fs.existsSync(bak)) fs.copyFileSync(target, bak);
      fs.writeFileSync(target, content);
      written.push(`${target} (updated; original at ${path.basename(bak)})`);
      return;
    }
    fs.writeFileSync(target, content);
    written.push(target);
  };

  // dir + bare file name (directory parts the model may emit are dropped).
  const write = (dir: string, fileName: string, content: string) =>
    writeTo(path.join(rootDir, dir, path.basename(fileName)), content);

  if (mode === 'api') {
    write('features/api', artifacts.featureFileName, artifacts.featureContent);
    write('src/steps/api', artifacts.stepsFileName, artifacts.stepsContent);
    // Support files keep their nested repo-relative path, but are confined to src/api.
    const apiRoot = path.resolve(rootDir, 'src/api');
    for (const sf of artifacts.supportFiles ?? []) {
      const rel = path.normalize(sf.path).replace(/^(\.\.(\/|\\|$))+/, '');
      const abs = path.resolve(rootDir, rel);
      if (abs !== apiRoot && !abs.startsWith(apiRoot + path.sep)) {
        written.push(`${sf.path} (SKIPPED — outside src/api)`);
        continue;
      }
      writeTo(abs, sf.content);
    }
    return written;
  }

  write('features', artifacts.featureFileName, artifacts.featureContent);
  write('src/steps', artifacts.stepsFileName, artifacts.stepsContent);
  for (const po of artifacts.pageObjects) {
    write('src/pages', po.fileName, po.content);
  }

  return written;
}

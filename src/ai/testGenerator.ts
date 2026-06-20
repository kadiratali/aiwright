import * as fs from 'fs';
import * as path from 'path';
import { getClient, MODEL } from './client';
import {
  GENERATOR_SYSTEM,
  DESIGN_SCOPED_INSTRUCTION,
  SELECTORS_INSTRUCTION,
  PROJECT_SURFACE_INSTRUCTION
} from './prompts';
import { redact } from './redact';
import { registerAllSensitive } from '../fixtures/data';
import { readProjectSurface } from './projectSurface';

export interface GeneratedArtifacts {
  featureFileName: string;
  featureContent: string;
  stepsFileName: string;
  stepsContent: string;
  pageObjects: { fileName: string; content: string }[];
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
      description: 'New Page Object files needed by the steps (empty if none)',
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
    notes: {
      type: 'string',
      description: 'Assumptions made, placeholder selectors to verify, suggested next steps'
    }
  },
  required: ['featureFileName', 'featureContent', 'stepsFileName', 'stepsContent', 'pageObjects', 'notes'],
  additionalProperties: false
} as const;

export async function generateTests(
  userStory: string,
  approvedDesign?: string,
  selectorMapJson?: string
): Promise<GeneratedArtifacts> {
  const client = getClient();

  // Before going to the LLM: load known secret values + redact the story (and the
  // human-edited design / selector map, if any).
  registerAllSensitive();
  const safeStory = redact(userStory);

  let content = `Generate the BDD test artifacts for this user story:\n\n${safeStory}`;

  // Ground generation in the project's real API surface so it reuses existing
  // helpers/methods/steps instead of inventing them (the "wiring gap").
  const surface = readProjectSurface();
  if (surface) content += `\n\n${PROJECT_SURFACE_INSTRUCTION}\n\nPROJECT API SURFACE:\n\n${surface}`;

  if (approvedDesign?.trim()) {
    const safeDesign = redact(approvedDesign);
    content += `\n\n${DESIGN_SCOPED_INSTRUCTION}\n\nAPPROVED TEST DESIGN:\n\n${safeDesign}`;
  }
  if (selectorMapJson?.trim()) {
    const safeMap = redact(selectorMapJson);
    content += `\n\n${SELECTORS_INSTRUCTION}\n\nSELECTOR MAP:\n\n${safeMap}`;
  }

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    system: GENERATOR_SYSTEM,
    output_config: {
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA }
    },
    messages: [
      {
        role: 'user',
        content
      }
    ]
  });

  stream.on('text', () => process.stdout.write('.'));
  const message = await stream.finalMessage();
  process.stdout.write('\n');

  if (message.stop_reason === 'refusal') {
    throw new Error('The model refused the request (stop_reason: refusal).');
  }

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response received from the model.');
  }
  return JSON.parse(textBlock.text) as GeneratedArtifacts;
}

export function writeArtifacts(artifacts: GeneratedArtifacts, rootDir = process.cwd()): string[] {
  const written: string[] = [];

  const write = (dir: string, fileName: string, content: string) => {
    // Drop any directory parts the model may emit; keep only the file name
    const target = path.join(rootDir, dir, path.basename(fileName));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      const backup = `${target}.generated`;
      fs.writeFileSync(backup, content);
      written.push(`${backup} (existing file was not overwritten)`);
      return;
    }
    fs.writeFileSync(target, content);
    written.push(target);
  };

  write('features', artifacts.featureFileName, artifacts.featureContent);
  write('src/steps', artifacts.stepsFileName, artifacts.stepsContent);
  for (const po of artifacts.pageObjects) {
    write('src/pages', po.fileName, po.content);
  }

  return written;
}

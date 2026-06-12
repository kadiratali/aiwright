import * as fs from 'fs';
import * as path from 'path';
import { getClient, MODEL } from './client';
import { GENERATOR_SYSTEM } from './prompts';

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

export async function generateTests(userStory: string): Promise<GeneratedArtifacts> {
  const client = getClient();

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
        content: `Generate the BDD test artifacts for this user story:\n\n${userStory}`
      }
    ]
  });

  stream.on('text', () => process.stdout.write('.'));
  const message = await stream.finalMessage();
  process.stdout.write('\n');

  if (message.stop_reason === 'refusal') {
    throw new Error('Model istegi reddetti (stop_reason: refusal).');
  }

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Modelden metin yaniti alinamadi.');
  }
  return JSON.parse(textBlock.text) as GeneratedArtifacts;
}

export function writeArtifacts(artifacts: GeneratedArtifacts, rootDir = process.cwd()): string[] {
  const written: string[] = [];

  const write = (dir: string, fileName: string, content: string) => {
    // Model ciktisindaki olasi dizin parcalarini at, sadece dosya adini kullan
    const target = path.join(rootDir, dir, path.basename(fileName));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      const backup = `${target}.generated`;
      fs.writeFileSync(backup, content);
      written.push(`${backup} (mevcut dosyanin uzerine yazilmadi)`);
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

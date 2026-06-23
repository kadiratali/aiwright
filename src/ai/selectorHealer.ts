import { getClient, MODEL } from './client';
import { SELECTOR_REPAIR_INSTRUCTION, PROJECT_SURFACE_INSTRUCTION } from './prompts';
import { redact } from './redact';
import { registerAllSensitive } from '../fixtures/data';
import { readProjectSurface } from './projectSurface';

/** A failed scenario as pulled from the Cucumber report (subset of failureAnalyzer's shape). */
export interface RuntimeFailure {
  scenario: string;
  failedStep: string;
  errorMessage: string;
}

/** A repo-relative source file the healer can read and (for changed files) rewrite. */
export interface SourceFile {
  path: string;
  content: string;
}

export interface SelectorRepair {
  files: SourceFile[];
  notes: string;
}

const REPAIR_SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      description: 'Only the files actually changed, with full new content.',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repo-relative path under src/pages or src/steps.' },
          content: { type: 'string', description: 'Complete new file content (not a diff).' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    },
    notes: { type: 'string', description: 'What was changed and why; any element still unresolved.' }
  },
  required: ['files', 'notes'],
  additionalProperties: false
} as const;

/**
 * Runtime selector self-heal: given scenarios that failed because a locator did not resolve
 * and a FRESH selector map re-inspected from the live page, returns corrected source files
 * that swap the failing locators for real ones. The compile-time counterpart is
 * `correctArtifacts` (tsc errors); this one is driven by run-time locator failures.
 */
export async function repairSelectors(
  story: string,
  failures: RuntimeFailure[],
  freshSelectorMapJson: string,
  sources: SourceFile[]
): Promise<SelectorRepair> {
  registerAllSensitive();

  const failureText = failures
    .map((f) => `Scenario: ${f.scenario}\nFailed step: ${f.failedStep}\nError:\n${f.errorMessage}`)
    .join('\n\n---\n\n');
  const sourcesText = sources.map((s) => `// ${s.path}\n${s.content}`).join('\n\n');

  let content =
    `${SELECTOR_REPAIR_INSTRUCTION}\n\nUSER STORY:\n\n${redact(story)}\n\n` +
    `RUNTIME FAILURES:\n\n${redact(failureText)}\n\n` +
    `FRESH SELECTOR MAP (re-inspected):\n\n${redact(freshSelectorMapJson)}\n\n` +
    `CURRENT PROJECT SOURCES (return only the ones you change):\n\n${redact(sourcesText)}`;

  const surface = readProjectSurface();
  if (surface) content += `\n\n${PROJECT_SURFACE_INSTRUCTION}\n\nPROJECT API SURFACE:\n\n${surface}`;

  const client = getClient();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    // Thinking disabled: like generation, adaptive thinking can consume the whole budget on
    // this large structured-output task and emit no answer. Disabled = straight to the JSON.
    thinking: { type: 'disabled' },
    output_config: { format: { type: 'json_schema', schema: REPAIR_SCHEMA } },
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
    throw new Error('No text response received from the model.');
  }
  return JSON.parse(textBlock.text) as SelectorRepair;
}

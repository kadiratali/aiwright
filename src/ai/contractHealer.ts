import { getClient, MODEL } from './client';
import { CONTRACT_REPAIR_INSTRUCTION, PROJECT_SURFACE_INSTRUCTION } from './prompts';
import { redact } from './redact';
import { registerAllSensitive } from '../fixtures/data';
import { readProjectSurface } from './projectSurface';
import type { RuntimeFailure, SourceFile } from './selectorHealer';

/**
 * API counterpart of selectorHealer. Where `repairSelectors` fixes a stale LOCATOR using a
 * fresh selector map, `repairContract` fixes a stale CONTRACT/assertion using the fresh, real
 * API response. Used when a run fails on schema drift ("Contract violation …", a body-shape
 * assertion, an unexpected status) — i.e. the test's expectation is out of date, not the API.
 *
 * Same {files, notes} shape as repairSelectors, constrained to the API suite (src/api,
 * src/steps/api). Whether a drift is a stale expectation (heal) or a real API regression
 * (escalate, do NOT heal) is decided upstream — this only rewrites expectations.
 */
export interface ContractRepair {
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
          path: { type: 'string', description: 'Repo-relative path under src/api or src/steps/api.' },
          content: { type: 'string', description: 'Complete new file content (not a diff).' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    },
    notes: { type: 'string', description: 'What was changed and why; any field still mismatched.' }
  },
  required: ['files', 'notes'],
  additionalProperties: false
} as const;

export async function repairContract(
  story: string,
  failures: RuntimeFailure[],
  freshResponseJson: string,
  sources: SourceFile[]
): Promise<ContractRepair> {
  registerAllSensitive();

  const failureText = failures
    .map((f) => `Scenario: ${f.scenario}\nFailed step: ${f.failedStep}\nError:\n${f.errorMessage}`)
    .join('\n\n---\n\n');
  const sourcesText = sources.map((s) => `// ${s.path}\n${s.content}`).join('\n\n');

  let content =
    `${CONTRACT_REPAIR_INSTRUCTION}\n\nUSER STORY:\n\n${redact(story)}\n\n` +
    `RUNTIME FAILURES:\n\n${redact(failureText)}\n\n` +
    `FRESH API RESPONSE (observed live):\n\n${redact(freshResponseJson)}\n\n` +
    `CURRENT PROJECT SOURCES (return only the ones you change):\n\n${redact(sourcesText)}`;

  const surface = readProjectSurface();
  if (surface) content += `\n\n${PROJECT_SURFACE_INSTRUCTION}\n\nPROJECT API SURFACE:\n\n${surface}`;

  const client = getClient();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    // Thinking disabled for the same reason as the other structured-output healers: adaptive
    // thinking can spend the whole budget and emit no JSON. Disabled = straight to the answer.
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
  return JSON.parse(textBlock.text) as ContractRepair;
}

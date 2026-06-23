import * as fs from 'fs';
import * as path from 'path';
import { getClient, MODEL } from './client';
import { ANALYZER_SYSTEM } from './prompts';
import { redactDeep } from './redact';
import { registerAllSensitive } from '../fixtures/data';

interface FailureRecord {
  feature: string;
  scenario: string;
  failedStep: string;
  errorMessage: string;
}

export interface FailureAnalysis {
  scenario: string;
  category: 'app-bug' | 'test-bug' | 'flaky' | 'environment';
  rootCause: string;
  suggestedFix: string;
  confidence: 'high' | 'medium' | 'low';
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    analyses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scenario: { type: 'string' },
          category: { type: 'string', enum: ['app-bug', 'test-bug', 'flaky', 'environment'] },
          rootCause: { type: 'string' },
          suggestedFix: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['scenario', 'category', 'rootCause', 'suggestedFix', 'confidence'],
        additionalProperties: false
      }
    },
    summary: { type: 'string', description: 'One-paragraph overall assessment of the run' }
  },
  required: ['analyses', 'summary'],
  additionalProperties: false
} as const;

export function extractFailures(reportPath: string): FailureRecord[] {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const failures: FailureRecord[] = [];

  for (const feature of report) {
    for (const element of feature.elements ?? []) {
      const failedStep = (element.steps ?? []).find(
        (s: any) => s.result?.status === 'failed'
      );
      if (failedStep) {
        failures.push({
          feature: feature.name,
          scenario: element.name,
          failedStep: `${failedStep.keyword}${failedStep.name}`,
          errorMessage: failedStep.result.error_message ?? 'unknown error'
        });
      }
    }
  }
  return failures;
}

export async function analyzeFailures(
  failures: FailureRecord[]
): Promise<{ analyses: FailureAnalysis[]; summary: string }> {
  const client = getClient();

  // Before going to the LLM: load secret values + redact the failure data (scenario
  // name, step text, ERROR MESSAGE). Playwright error messages can contain
  // expected/received values; this is the biggest leak vector.
  registerAllSensitive();
  const safeFailures = redactDeep(failures);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    // Thinking disabled: adaptive thinking + structured output can spend the whole token
    // budget reasoning and emit no answer (same runaway fixed in testGenerator/selectorHealer).
    thinking: { type: 'disabled' },
    system: ANALYZER_SYSTEM,
    output_config: {
      format: { type: 'json_schema', schema: ANALYSIS_SCHEMA }
    },
    messages: [
      {
        role: 'user',
        content: `Analyze these failed scenarios:\n\n${JSON.stringify(safeFailures, null, 2)}`
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
  return JSON.parse(textBlock.text);
}

export function writeAnalysisReport(
  result: { analyses: FailureAnalysis[]; summary: string },
  rootDir = process.cwd()
): string {
  const lines: string[] = ['# AI Failure Analysis', '', `> ${result.summary}`, ''];

  for (const a of result.analyses) {
    lines.push(
      `## ${a.scenario}`,
      '',
      `- **Category:** \`${a.category}\` (confidence: ${a.confidence})`,
      `- **Root cause:** ${a.rootCause}`,
      `- **Suggested fix:** ${a.suggestedFix}`,
      ''
    );
  }

  const target = path.join(rootDir, 'reports', 'ai-analysis.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.join('\n'));
  return target;
}

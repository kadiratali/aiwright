import * as fs from 'fs';
import * as path from 'path';
import { getClient, MODEL } from './client';
import { DESIGNER_SYSTEM } from './prompts';
import { redact } from './redact';
import { registerAllSensitive } from '../fixtures/data';

export interface RiskArea {
  area: string;
  severity: 'high' | 'medium' | 'low';
  reason: string;
}

export interface ScenarioIdea {
  title: string;
  type: 'happy-path' | 'negative' | 'edge' | 'boundary' | 'security' | 'performance' | 'accessibility';
  priority: 'P0' | 'P1' | 'P2';
  rationale: string;
  suggestedTags: string[];
}

export interface OutOfScopeItem {
  item: string;
  reason: string;
}

export interface TestDesign {
  title: string;
  understanding: string;
  riskAreas: RiskArea[];
  scenarios: ScenarioIdea[];
  openQuestions: string[];
  assumptions: string[];
  outOfScope: OutOfScopeItem[];
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short feature title derived from the story' },
    understanding: {
      type: 'string',
      description: 'One short paragraph restating what the feature must do'
    },
    riskAreas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' }
        },
        required: ['area', 'severity', 'reason'],
        additionalProperties: false
      }
    },
    scenarios: {
      type: 'array',
      description: 'Test ideas (titles + rationale), NOT Gherkin steps',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          type: {
            type: 'string',
            enum: ['happy-path', 'negative', 'edge', 'boundary', 'security', 'performance', 'accessibility']
          },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          rationale: { type: 'string' },
          suggestedTags: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'type', 'priority', 'rationale', 'suggestedTags'],
        additionalProperties: false
      }
    },
    openQuestions: {
      type: 'array',
      description: 'Ambiguous/missing requirements a human must clarify',
      items: { type: 'string' }
    },
    assumptions: { type: 'array', items: { type: 'string' } },
    outOfScope: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['item', 'reason'],
        additionalProperties: false
      }
    }
  },
  required: ['title', 'understanding', 'riskAreas', 'scenarios', 'openQuestions', 'assumptions', 'outOfScope'],
  additionalProperties: false
} as const;

export async function designTests(userStory: string): Promise<TestDesign> {
  const client = getClient();

  // Before going to the LLM: load known secret values + redact the story.
  registerAllSensitive();
  const safeStory = redact(userStory);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    system: DESIGNER_SYSTEM,
    output_config: {
      format: { type: 'json_schema', schema: DESIGN_SCHEMA }
    },
    messages: [
      {
        role: 'user',
        content: `Produce a test design for this user story:\n\n${safeStory}`
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
  return JSON.parse(textBlock.text) as TestDesign;
}

const SEVERITY_ICON: Record<RiskArea['severity'], string> = {
  high: '🔴',
  medium: '🟡',
  low: '🟢'
};

export function renderDesignMarkdown(design: TestDesign): string {
  const lines: string[] = [
    `# Test Design — ${design.title}`,
    '',
    `> ${design.understanding}`,
    '',
    '_This document is the "what to test" layer — not code. Review it, edit it, make the ' +
      'scope calls; then turn the approved scenarios into code with `npm run ai:generate`._',
    ''
  ];

  lines.push('## Risk Areas', '');
  if (design.riskAreas.length === 0) {
    lines.push('_No notable risk areas identified._', '');
  } else {
    lines.push('| Severity | Area | Why |', '| --- | --- | --- |');
    for (const r of design.riskAreas) {
      lines.push(`| ${SEVERITY_ICON[r.severity]} ${r.severity} | ${r.area} | ${r.reason} |`);
    }
    lines.push('');
  }

  lines.push('## Test Scenarios (ideas)', '');
  const order = { P0: 0, P1: 1, P2: 2 };
  const sorted = [...design.scenarios].sort((a, b) => order[a.priority] - order[b.priority]);
  for (const s of sorted) {
    const tags = s.suggestedTags.length ? `  \`${s.suggestedTags.join(' ')}\`` : '';
    lines.push(`- **[${s.priority}]** ${s.title} _(${s.type})_${tags}`);
    lines.push(`  - ${s.rationale}`);
  }
  lines.push('');

  lines.push('## Open Questions (clarify requirements)', '');
  if (design.openQuestions.length === 0) {
    lines.push('_No open questions._', '');
  } else {
    for (const q of design.openQuestions) lines.push(`- [ ] ${q}`);
    lines.push('');
  }

  lines.push('## Assumptions', '');
  if (design.assumptions.length === 0) {
    lines.push('_No assumptions._', '');
  } else {
    for (const a of design.assumptions) lines.push(`- ${a}`);
    lines.push('');
  }

  lines.push('## Out of Scope (deliberate decision)', '');
  if (design.outOfScope.length === 0) {
    lines.push('_Nothing deliberately left out of scope._', '');
  } else {
    for (const o of design.outOfScope) lines.push(`- **${o.item}** — ${o.reason}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function writeDesignReport(design: TestDesign, rootDir = process.cwd()): string {
  const slug =
    design.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'test-design';
  const target = path.join(rootDir, 'reports', `test-design-${slug}.md`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderDesignMarkdown(design));
  return target;
}

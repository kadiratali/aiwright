import * as readline from 'readline';
import type { ToolName } from './tools';

/**
 * The agent's human-interaction surface, made injectable so the same orchestrator loop can
 * run on the CLI (readline + console) or behind the web UI (SSE + HTTP decisions). The
 * orchestrator never talks to stdin/stdout directly — it only goes through an AgentIO.
 */
export type AgentOutcome = 'completed' | 'halted' | 'aborted';

export type AgentEvent =
  | { type: 'start'; goal: string }
  | { type: 'plan'; text: string }
  | { type: 'tool'; tool: ToolName; decision: 'auto' | 'confirm'; reason: string; input: unknown }
  | { type: 'awaiting-approval'; tool: ToolName; reason: string }
  | { type: 'declined'; tool: ToolName }
  | { type: 'result'; tool: ToolName; ok: boolean; summary: string; artifact?: string }
  | { type: 'error'; tool: ToolName; message: string }
  | { type: 'escalation'; reason: string }
  | { type: 'done'; outcome: AgentOutcome; statePath: string };

export interface AgentIO {
  emit(event: AgentEvent): void;
  /** Side-effecting step needs a human OK. */
  approve(tool: ToolName, reason: string, input: unknown): Promise<'yes' | 'no' | 'abort'>;
  /** A semantic gate (e.g. a real regression) needs a human decision. */
  escalate(reason: string): Promise<'continue' | 'halt'>;
}

// ---- CLI implementation (readline + console) -------------------------------

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    })
  );
}

async function confirm(question: string): Promise<'yes' | 'no' | 'abort'> {
  const a = await ask(question);
  if (a === 'a' || a === 'abort') return 'abort';
  if (a === 'y' || a === 'yes') return 'yes';
  return 'no'; // default to the safe choice
}

/**
 * The semantic escalation gate, in CLI form: a tool flagged something only a human should
 * decide. Interactive runs block on a y/abort prompt; `--auto` runs do not block but still
 * surface the flag. Exported because scripts/demo-escalation.ts exercises it directly.
 */
export async function resolveEscalation(
  reason: string,
  opts: { auto?: boolean } = {}
): Promise<'continue' | 'halt'> {
  console.log(`\n⚠ ESCALATION: ${reason}`);
  if (opts.auto) {
    console.log('  (--auto) Not blocking — flagged for the human and fed back to the agent.');
    return 'continue';
  }
  const ans = await confirm('  Continue the run anyway? [y]es / [a]bort: ');
  return ans === 'yes' ? 'continue' : 'halt';
}

/** Default IO for the CLI — reproduces the orchestrator's original console output. */
export function cliIO(auto: boolean): AgentIO {
  return {
    emit(e) {
      switch (e.type) {
        case 'plan':
          console.log(`\n🧠 ${e.text}`);
          break;
        case 'tool':
          console.log(`\n▶ ${e.tool}  (${e.decision}) — ${e.reason}`);
          if (e.input && Object.keys(e.input as object).length) {
            console.log(`  input: ${JSON.stringify(e.input)}`);
          }
          break;
        case 'declined':
          console.log(`  ✗ declined "${e.tool}"`);
          break;
        case 'result':
          console.log(`  ${e.ok ? '✓' : '✗'} ${e.summary}`);
          break;
        case 'error':
          console.log(`  ✗ error: ${e.message}`);
          break;
        case 'done':
          if (e.outcome === 'halted') console.log('\nHalted for human review.');
          if (e.outcome === 'aborted') console.log('\nAborted by user.');
          console.log(`Run state: ${e.statePath}`);
          break;
        // 'start' / 'awaiting-approval' / 'escalation' are handled by the prompt flow below.
      }
    },
    async approve(tool) {
      return confirm(`  Approve "${tool}"? [y]es / [n]o / [a]bort: `);
    },
    async escalate(reason) {
      return resolveEscalation(reason, { auto });
    }
  };
}

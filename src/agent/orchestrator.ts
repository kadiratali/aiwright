import * as readline from 'readline';
import Anthropic from '@anthropic-ai/sdk';

import { getClient, MODEL } from '../ai/client';
import { AGENT_SYSTEM } from './prompts';
import { TOOL_DEFS, executeTool, ToolName } from './tools';
import { classify } from './policy';
import { RunState, newRunState, recordAttempt, persist } from './state';

const DEFAULT_MAX_TURNS = 24;

export interface AgentOptions {
  /** Skip human confirmation gates (e.g. CI / non-interactive). */
  auto?: boolean;
  maxTurns?: number;
}

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
 * The semantic escalation gate: a tool flagged something only a human should decide (e.g. a
 * failure that looks like a real app regression). Interactive runs block on a y/abort prompt;
 * `--auto` runs do not block but still surface the flag and feed it back to the agent.
 */
export async function resolveEscalation(
  escalate: string,
  opts: AgentOptions = {}
): Promise<'continue' | 'halt'> {
  console.log(`\n⚠ ESCALATION: ${escalate}`);
  if (opts.auto) {
    console.log('  (--auto) Not blocking — flagged for the human and fed back to the agent.');
    return 'continue';
  }
  const ans = await confirm('  Continue the run anyway? [y]es / [a]bort: ');
  return ans === 'yes' ? 'continue' : 'halt';
}

/**
 * The plan → act → observe loop. Hands the goal + tools to the model, runs each tool it
 * picks (pausing for a human OK on side-effecting steps), feeds the result back, and repeats
 * until the model is done or the turn budget is spent.
 */
export async function runAgent(
  goal: string,
  story: string,
  rootDir = process.cwd(),
  opts: AgentOptions = {}
): Promise<RunState> {
  const client = getClient();
  const state = newRunState(goal, story);
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Goal: ${goal}\n\nUser story:\n${story}` }
  ];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: AGENT_SYSTEM,
      tools: TOOL_DEFS,
      messages
    });
    messages.push({ role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] });

    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim()) console.log(`\n🧠 ${block.text.trim()}`);
    }

    if (message.stop_reason !== 'tool_use') break; // end_turn / max_tokens / stop_sequence

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    const results: Anthropic.ContentBlockParam[] = [];

    for (const tu of toolUses) {
      const name = tu.name as ToolName;
      const gate = classify(name, { auto: opts.auto });
      console.log(`\n▶ ${name}  (${gate.decision}) — ${gate.reason}`);
      if (tu.input && Object.keys(tu.input).length) console.log(`  input: ${JSON.stringify(tu.input)}`);

      if (gate.decision === 'confirm') {
        const answer = await confirm(`  Approve "${name}"? [y]es / [n]o / [a]bort: `);
        if (answer === 'abort') {
          console.log('\nAborted by user.');
          console.log(`Run state: ${persist(state, rootDir)}`);
          return state;
        }
        if (answer === 'no') {
          const note = `Human declined "${name}".`;
          state.notes.push(note);
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `${note} Replan or stop and explain — do not retry this blindly.`
          });
          continue;
        }
      }

      try {
        const r = await executeTool(name, tu.input, state, rootDir);
        recordAttempt(state, {
          step: name,
          at: new Date().toISOString(),
          ok: r.ok,
          summary: r.summary,
          artifact: r.artifact
        });
        console.log(`  ${r.ok ? '✓' : '✗'} ${r.summary}`);

        let content = r.summary;
        // Semantic gate: a tool flagged something a human must decide (e.g. a real regression).
        if (r.escalate) {
          content += `\n\n[ESCALATION — human decision required] ${r.escalate}`;
          const outcome = await resolveEscalation(r.escalate, opts);
          if (outcome === 'halt') {
            state.notes.push(`Halted on escalation: ${r.escalate}`);
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: `${content}\nHuman halted the run here for triage.`
            });
            messages.push({ role: 'user', content: results });
            console.log('\nHalted for human review.');
            console.log(`Run state: ${persist(state, rootDir)}`);
            return state;
          }
          state.notes.push(`Escalation acknowledged, continued: ${r.escalate}`);
        }

        results.push({ type: 'tool_result', tool_use_id: tu.id, content, is_error: !r.ok });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        recordAttempt(state, { step: name, at: new Date().toISOString(), ok: false, summary: `error: ${msg}` });
        console.log(`  ✗ error: ${msg}`);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Tool error: ${msg}`, is_error: true });
      }
      persist(state, rootDir);
    }

    messages.push({ role: 'user', content: results });
  }

  console.log(`\nRun state: ${persist(state, rootDir)}`);
  return state;
}

import type { StepKind } from './state';

/**
 * Guardrails — the heart of the "amplify, not replace" stance. The agent runs autonomously,
 * but side-effecting steps pause for a human OK. Read-only steps run automatically.
 *
 * This file gates by side effect (per-tool). *Semantic* gates — e.g. a failure that looks
 * like a real app regression — are handled separately in the orchestrator via a tool's
 * `escalate` signal, so they pause the human regardless of which tool produced them.
 */
export type Decision = 'auto' | 'confirm';

export interface PolicyResult {
  decision: Decision;
  reason: string;
}

const RULES: Record<StepKind, PolicyResult> = {
  design: { decision: 'auto', reason: 'Produces a review-only design report — no code.' },
  inspect: { decision: 'confirm', reason: 'Opens a live browser session against the target URL.' },
  generate: { decision: 'confirm', reason: 'Writes/overwrites feature, step and page-object source files.' },
  heal: { decision: 'auto', reason: 'Targeted compile-error fix on already-generated code — low risk, gated by tsc.' },
  verify: { decision: 'auto', reason: 'Read-only type-check (tsc --noEmit).' },
  run: { decision: 'confirm', reason: 'Launches a real browser and executes scenarios.' },
  analyze: { decision: 'auto', reason: 'Reads the report and writes an analysis — no code.' }
};

export function classify(step: StepKind, opts: { auto?: boolean } = {}): PolicyResult {
  const base = RULES[step];
  // --auto (e.g. CI / non-interactive): gates become non-blocking, but the reason is kept
  // so the run record still shows what would have needed a human.
  if (opts.auto && base.decision === 'confirm') {
    return { decision: 'auto', reason: `${base.reason} [--auto: confirmation skipped]` };
  }
  return base;
}

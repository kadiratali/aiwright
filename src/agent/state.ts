import * as fs from 'fs';
import * as path from 'path';
import type { GeneratedArtifacts } from '../ai/testGenerator';

/** The pipeline steps the agent can take (each maps to an existing ai/* module). */
export type StepKind =
  | 'design'
  | 'inspect'
  | 'generate'
  | 'heal'
  | 'heal-selectors'
  | 'verify'
  | 'run'
  | 'analyze';

export interface RunAttempt {
  step: StepKind;
  at: string;
  ok: boolean;
  /** Compact, human-readable outcome (also fed back to the model as the tool result). */
  summary: string;
  /** Path to a produced report/artifact, if any. */
  artifact?: string;
}

/**
 * Memory for one agent run. This is the piece the old pipeline lacked: it lets the
 * orchestrator carry state across steps (verified selectors, generated files, history)
 * instead of each command starting from scratch. Persisted to reports/agent-run-<slug>.json.
 */
export interface RunState {
  goal: string;
  story: string;
  slug: string;
  startedAt: string;

  // Produced artifacts (paths into reports/ or src/)
  designPath?: string;
  selectorMapPath?: string;
  /** Generated .ts files — the scope handed to `verify`. */
  artifactFiles: string[];
  /** Feature title of the last generated suite — the grep handed to `run`. */
  lastFeatureTitle?: string;
  /** Last generated/corrected artifacts — the base `heal` corrects against. */
  lastArtifacts?: GeneratedArtifacts;
  /** How many targeted `heal` rounds have run (bounded to stop infinite fix loops). */
  healRounds: number;
  /** How many runtime `heal-selectors` rounds have run (bounded the same way). */
  healSelectorRounds: number;
  /** Pass/fail tally of the last `run` — used by `analyze` to detect a stale report. */
  lastRunPassed?: number;
  lastRunFailed?: number;

  /** Full step history (used for flaky-vs-regression reasoning). */
  attempts: RunAttempt[];
  /** Free-form notes, e.g. human-declined actions. */
  notes: string[];
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'run'
  );
}

export function newRunState(goal: string, story: string): RunState {
  return {
    goal,
    story,
    slug: slugify(story.split('\n')[0] || goal),
    startedAt: new Date().toISOString(),
    artifactFiles: [],
    healRounds: 0,
    healSelectorRounds: 0,
    attempts: [],
    notes: []
  };
}

export function recordAttempt(state: RunState, attempt: RunAttempt): void {
  state.attempts.push(attempt);
}

/** Writes the run state to reports/agent-run-<slug>.json and returns the path. */
export function persist(state: RunState, rootDir = process.cwd()): string {
  const target = path.join(rootDir, 'reports', `agent-run-${state.slug}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(state, null, 2));
  return target;
}

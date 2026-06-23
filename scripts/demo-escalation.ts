/**
 * Offline demo of the agent's semantic escalation gate — no API calls.
 *
 * Drives the REAL gate (`resolveEscalation` from the orchestrator) with the app-bug the live
 * analyzer already categorised ("Login with an unregistered email"). Shows that a real
 * regression blocks the run for a human instead of being healed green.
 *
 *   npx ts-node scripts/demo-escalation.ts --auto     # non-blocking: flag + continue
 *   printf 'a\n' | npx ts-node scripts/demo-escalation.ts   # interactive: abort -> HALT
 *   printf 'y\n' | npx ts-node scripts/demo-escalation.ts   # interactive: yes   -> continue
 */
import { resolveEscalation } from '../src/agent/orchestrator';

// The exact escalate string the `analyze` tool emits when a failure is categorised app-bug.
const ESCALATE =
  '1 failure(s) look like REAL app bugs (regressions): Login with an unregistered email. ' +
  'Do NOT heal these to force green — a human must triage.';

async function main() {
  const auto = process.argv.includes('--auto');
  console.log(`Mode: ${auto ? '--auto (non-interactive)' : 'interactive'}`);

  const outcome = await resolveEscalation(ESCALATE, { auto });

  console.log(`\nGate outcome: ${outcome.toUpperCase()}`);
  console.log(
    outcome === 'halt'
      ? '→ Run stopped. The app-bug is left red for a human to triage — NOT healed green.'
      : '→ Run proceeds (the flag was surfaced and recorded).'
  );
  process.exit(0);
}

main();

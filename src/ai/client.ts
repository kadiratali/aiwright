import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

// Sonnet 4.6 over Opus 4.8 for cost: ~0.6x the per-token price ($3/$15 vs $5/$25 per 1M
// in/out) with adaptive thinking + structured outputs still supported. One change here
// retargets every AI module and the agent orchestrator.
export const MODEL = 'claude-sonnet-4-6';

let client: Anthropic | undefined;

export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Create a .env file (see .env.example).'
    );
  }
  client ??= new Anthropic();
  return client;
}

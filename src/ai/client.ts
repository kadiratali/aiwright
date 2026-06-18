import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

export const MODEL = 'claude-opus-4-8';

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

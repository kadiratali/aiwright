import * as fs from 'fs';
import * as path from 'path';

/**
 * `aiwright init` scaffolding. Writes the project-owned layer a new target needs — the single
 * config file, an .env, a starter story, and the directory layout the pipeline writes into —
 * so onboarding a new app is "fill in aiwright.config.ts and go" instead of hand-creating files.
 * Non-destructive: existing files are skipped unless `force` is set.
 */
export interface ScaffoldOptions {
  targetUrl?: string;
  apiBaseUrl?: string;
  force?: boolean;
}

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
}

function configTemplate(targetUrl: string, apiBaseUrl: string): string {
  return `/**
 * aiwright project config — the ONE place to retarget the suite to a different application.
 * Change these values (or override any via the matching env var: TARGET_URL/BASE_URL,
 * API_BASE_URL, OPENAPI_SPEC) and the whole pipeline (inspect, probe, generate, run, heal) follows.
 */
export interface AiwrightConfig {
  /** Base URL of the UI under test — browser navigation + \`inspect\`. */
  targetUrl: string;
  /** Base URL of the API under test — \`probe\`, the api fixtures, \`heal-contract\`. */
  apiBaseUrl: string;
  /** Path to the OpenAPI spec \`probe\` grounds API generation in. */
  openApiSpec: string;
  /** test-id attribute conventions the inspector recognises, in PRIORITY order (most stable first). */
  testIdAttributes: string[];
}

const config: AiwrightConfig = {
  targetUrl: ${JSON.stringify(targetUrl)},
  apiBaseUrl: ${JSON.stringify(apiBaseUrl)},
  openApiSpec: 'docs/api/openapi.json',
  testIdAttributes: [
    'data-test',
    'data-testid',
    'data-test-id',
    'data-cy',
    'data-qa',
    'data-automation-id',
    'data-e2e'
  ]
};

export default config;
`;
}

function envTemplate(targetUrl: string, apiBaseUrl: string): string {
  return `# Claude API key (required for AI test generation and failure analysis)
ANTHROPIC_API_KEY=sk-ant-...

# Optional env overrides for aiwright.config.ts (these win at runtime):
BASE_URL=${targetUrl}
API_BASE_URL=${apiBaseUrl}
# OPENAPI_SPEC=docs/api/openapi.json

# true = run the browser headless
HEADLESS=true
`;
}

function exampleStory(targetUrl: string): string {
  return `# Example user story

As a visitor to ${targetUrl}, I can search for a product from the header so that
I can quickly find what I want to buy.

Acceptance criteria:
- Typing a known term and submitting shows at least one matching result.
- A nonsense term shows a clear "no results" empty state, not an error.
- The results page reflects the term I searched for.

Run it:
  npm run ai:design   -- stories/example.md     # what to test (review this first)
  npm run ai:agent    -- stories/example.md     # let the agent build + verify the suite
`;
}

const README_STUB = `# aiwright target project

This project is driven by **aiwright** (AI QA agent). To point it at your app, edit
**aiwright.config.ts** (targetUrl / apiBaseUrl / openApiSpec / testIdAttributes).

Quick start:
1. Set \`ANTHROPIC_API_KEY\` in \`.env\`.
2. Edit \`aiwright.config.ts\` for your app.
3. Write a story under \`stories/\`, then \`npm run ai:agent -- stories/<your-story>.md\`.
`;

export function scaffold(rootDir: string, opts: ScaffoldOptions = {}): ScaffoldResult {
  const targetUrl = opts.targetUrl ?? 'https://your-app.example.com';
  const apiBaseUrl = opts.apiBaseUrl ?? 'http://localhost:4010';
  const created: string[] = [];
  const skipped: string[] = [];

  const write = (rel: string, content: string) => {
    const abs = path.join(rootDir, rel);
    if (fs.existsSync(abs) && !opts.force) {
      skipped.push(rel);
      return;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    created.push(rel);
  };

  write('aiwright.config.ts', configTemplate(targetUrl, apiBaseUrl));
  write('.env', envTemplate(targetUrl, apiBaseUrl));
  write('stories/example.md', exampleStory(targetUrl));
  write('README.md', README_STUB);

  // The directory layout the pipeline generates into (kept in git via .gitkeep).
  for (const dir of ['features', 'src/steps', 'src/pages', 'src/api', 'docs/api']) {
    write(path.join(dir, '.gitkeep'), '');
  }

  return { created, skipped };
}

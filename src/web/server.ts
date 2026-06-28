import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import express, { Request, Response } from 'express';
import { designTests, renderDesignMarkdown, TestDesign } from '../ai/testDesigner';
import { generateTests, writeArtifacts, correctArtifacts, GeneratedArtifacts } from '../ai/testGenerator';
import { inspectPage, SelectorMap } from '../ai/pageInspector';
import { probeApi, EndpointMap } from '../ai/specProbe';
import { verifyTypeScript, runFeature } from '../ai/verifier';
import { runAgent } from '../agent/orchestrator';
import { AgentIO, AgentEvent } from '../agent/io';

const app = express();
app.use(express.json({ limit: '1mb' }));
// Per-run Allure reports are served here at /report/<runId>/.
const RUN_REPORTS_DIR = path.join(process.cwd(), 'reports', 'run-reports');
app.use('/report', express.static(RUN_REPORTS_DIR));
// Scenario Studio is the home page ('/'); the older code studio (index.html) is retired.
app.use(express.static(path.join(process.cwd(), 'public'), { index: 'scenarios.html' }));

const tsScope = (written: string[]) => written.map((w) => w.split(' ')[0]).filter((f) => f.endsWith('.ts'));

/** Reads the project source files the self-correction step may need to update (mode-aware). */
function projectSources(mode: 'ui' | 'api' = 'ui', rootDir = process.cwd()): { fileName: string; content: string }[] {
  const dirs = mode === 'api' ? ['src/api', 'src/steps/api'] : ['src/pages', 'src/fixtures'];
  const out: { fileName: string; content: string }[] = [];
  const walk = (rel: string) => {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(childRel);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.generated') && !entry.name.endsWith('.bak')) {
        out.push({ fileName: childRel, content: fs.readFileSync(path.join(rootDir, childRel), 'utf-8') });
      }
    }
  };
  for (const d of dirs) walk(d);
  return out;
}

// Minimum security for a local tool that holds an API key and writes files:
// - only accept a localhost Host (blocks DNS-rebinding / cross-origin browser calls),
// - optionally require a shared token (set AIWRIGHT_TOKEN to enable).
// Combined with binding to 127.0.0.1, this keeps the endpoints off the network.
const TOKEN = process.env.AIWRIGHT_TOKEN;
app.use('/api', (req, res, next) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    res.status(403).json({ error: 'Forbidden host.' });
    return;
  }
  if (TOKEN && req.headers['x-aiwright-token'] !== TOKEN) {
    res.status(401).json({ error: 'Missing or invalid token.' });
    return;
  }
  next();
});

/** Wraps an async handler so rejections return a clean JSON error. */
const handler =
  (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  };

/** Compact, model-friendly summary of an inspected page — UI grounding for the design. */
function siteContextFrom(map: SelectorMap): string {
  const named = map.entries
    .filter((e) => e.name && !e.unresolved)
    .slice(0, 40)
    .map((e) => `- ${e.role ?? e.tag}${e.name ? ` "${e.name}"` : ''}`);
  return [
    `UI page title: ${map.title}`,
    `URL: ${map.url}`,
    named.length ? `Notable elements on the page:\n${named.join('\n')}` : 'No notable named elements found.'
  ].join('\n');
}

/** Compact summary of a probed OpenAPI spec — API grounding for the design. */
function apiContextFrom(map: EndpointMap): string {
  const lines = map.endpoints.map(
    (e) =>
      `- ${e.method} ${e.path}${e.summary ? ` — ${e.summary}` : ''}` +
      (e.responses.length ? ` [statuses: ${e.responses.map((r) => r.status).join(', ')}]` : '')
  );
  return [
    `API: ${map.title}${map.version ? ` v${map.version}` : ''}`,
    `Base URL: ${map.baseUrl}`,
    lines.length ? `Endpoints:\n${lines.join('\n')}` : 'No endpoints found in the spec.'
  ].join('\n');
}

/** Probes an OpenAPI spec given as a URL (fetched) or pasted JSON. Spec-only (no live calls). */
async function probeSpecInput(input: string): Promise<EndpointMap> {
  let json: string;
  if (/^https?:\/\//i.test(input)) {
    const r = await fetch(input);
    if (!r.ok) throw new Error(`Could not fetch the spec (HTTP ${r.status}) from ${input}`);
    json = await r.text();
  } else {
    json = input;
  }
  try {
    JSON.parse(json);
  } catch {
    throw new Error('The OpenAPI spec must be valid JSON (paste JSON, or a URL that returns JSON).');
  }
  const tmp = path.join(os.tmpdir(), `aiwright-spec-${crypto.randomUUID()}.json`);
  fs.writeFileSync(tmp, json);
  try {
    return await probeApi(tmp, { live: false });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// PRODUCT flow: { stories, siteUrl?, apiSpec? } -> scenarios. Grounds the test design in the real
// system — a live UI inspect (siteUrl), an OpenAPI probe (apiSpec = URL or pasted JSON), or both —
// and returns the scenarios (no code written). "Enter your site and/or API, share your stories,
// get the scenarios."
app.post(
  '/api/scenarios',
  handler(async (req, res) => {
    const stories = String(req.body?.stories ?? '').trim();
    const siteUrl = String(req.body?.siteUrl ?? '').trim();
    const apiSpec = String(req.body?.apiSpec ?? '').trim();
    // Stories are optional: a site or an API spec is enough to design from (the system is the
    // requirement). At least one of the three must be present.
    if (!stories && !siteUrl && !apiSpec) {
      res.status(400).json({ error: 'Provide a site URL, an API spec, or your stories.' });
      return;
    }

    const contexts: string[] = [];
    let site: unknown;
    let api: unknown;

    if (siteUrl) {
      if (!/^https?:\/\//i.test(siteUrl)) {
        res.status(400).json({ error: 'Site URL must start with http:// or https://' });
        return;
      }
      const map = await inspectPage(siteUrl);
      contexts.push(siteContextFrom(map));
      site = { title: map.title, url: map.url, elements: map.entries.length, warnings: map.warnings };
    }

    if (apiSpec) {
      const map = await probeSpecInput(apiSpec);
      contexts.push(apiContextFrom(map));
      api = { title: map.title, version: map.version, baseUrl: map.baseUrl, endpoints: map.endpoints.length };
    }

    const design = await designTests(stories, undefined, contexts.join('\n\n---\n\n'));
    res.json({ design, site, api });
  })
);

// Story -> structured test design (the "what to test" layer).
app.post(
  '/api/design',
  handler(async (req, res) => {
    const story = String(req.body?.story ?? '').trim();
    if (!story) {
      res.status(400).json({ error: 'Provide a user story.' });
      return;
    }
    const design = await designTests(story);
    res.json(design);
  })
);

// Approved scenarios -> generated artifacts. The selected subset becomes the
// authoritative scope, reusing the same design->markdown->generate path as the CLI.
app.post(
  '/api/generate',
  handler(async (req, res) => {
    const story = String(req.body?.story ?? '').trim();
    const design = req.body?.design as TestDesign | undefined;
    const selected = (req.body?.selected as number[] | undefined) ?? [];
    if (!story || !design) {
      res.status(400).json({ error: 'Provide the story and the design.' });
      return;
    }
    const scenarios = design.scenarios.filter((_, i) => selected.includes(i));
    if (scenarios.length === 0) {
      res.status(400).json({ error: 'Select at least one scenario.' });
      return;
    }
    const approved: TestDesign = { ...design, scenarios };
    const artifacts = await generateTests(story, renderDesignMarkdown(approved));
    res.json(artifacts);
  })
);

// PRODUCT flow step 2: selected scenarios -> a runnable suite written into the project.
// Re-grounds in the same system (API spec -> endpoint map + API mode, else site -> selector map +
// UI mode), generates the feature + steps + clients/page objects for ONLY the chosen scenarios,
// writes them, type-checks, and self-corrects up to 2 rounds so the result compiles.
app.post(
  '/api/generate-suite',
  handler(async (req, res) => {
    const stories = String(req.body?.stories ?? '').trim();
    const siteUrl = String(req.body?.siteUrl ?? '').trim();
    const apiSpec = String(req.body?.apiSpec ?? '').trim();
    const design = req.body?.design as TestDesign | undefined;
    const selected = (req.body?.selected as number[] | undefined) ?? [];
    if (!design) {
      res.status(400).json({ error: 'Provide the design.' });
      return;
    }
    const scenarios = design.scenarios.filter((_, i) => selected.includes(i));
    if (scenarios.length === 0) {
      res.status(400).json({ error: 'Select at least one scenario.' });
      return;
    }
    const approved: TestDesign = { ...design, scenarios };

    // Mode + grounding follow the source: an API spec -> API lane; otherwise the site -> UI lane.
    const mode: 'ui' | 'api' = apiSpec ? 'api' : 'ui';
    let mapJson: string | undefined;
    if (apiSpec) {
      mapJson = JSON.stringify(await probeSpecInput(apiSpec), null, 2);
    } else if (siteUrl) {
      mapJson = JSON.stringify(await inspectPage(siteUrl), null, 2);
    }

    const storyText = stories || approved.understanding || approved.title;
    let artifacts = await generateTests(storyText, renderDesignMarkdown(approved), mapJson, undefined, mode);
    let written = writeArtifacts(artifacts, process.cwd(), { overwrite: true }, mode);
    let verify = verifyTypeScript(tsScope(written));
    let rounds = 0;
    while (!verify.ok && rounds < 2) {
      rounds++;
      artifacts = await correctArtifacts(storyText, artifacts, verify.errors, projectSources(mode), mapJson, mode);
      written = writeArtifacts(artifacts, process.cwd(), { overwrite: true }, mode);
      verify = verifyTypeScript(tsScope(written));
    }

    res.json({
      mode,
      written,
      rounds,
      notes: artifacts.notes,
      verify: { ok: verify.ok, errors: verify.errors }
    });
  })
);

// Minimal single-project Playwright config written into each run workspace: chromium only,
// baseURL pinned to that run's TARGET_URL, Allure results, no webServer/mock, UI steps only.
const WORKSPACE_CONFIG = `import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['src/steps/*.ts', 'src/fixtures/**/*.ts']
});

export default defineConfig({
  testDir,
  reporter: [['list'], ['allure-playwright', { resultsDir: 'reports/allure-results' }]],
  use: {
    baseURL: process.env.TARGET_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
`;

/**
 * Creates an isolated, runnable workspace for ONE run: a clone of the project (node_modules
 * symlinked to stay fast/cheap, secrets + reports + existing features excluded) with a minimal
 * single-project config and an empty features/ for the generated suite. Each run is sandboxed —
 * no shared-cwd writes, no cross-run collisions, its own TARGET_URL.
 */
function setupWorkspace(rootDir: string): { ws: string; id: string } {
  const id = crypto.randomUUID().slice(0, 8);
  const ws = path.join(os.tmpdir(), `neuralqa-run-${id}`);
  const SKIP = ['node_modules', '.git', 'reports', '.features-gen', 'dist', 'features', '.env', 'fixtures/sensitive'];
  fs.cpSync(rootDir, ws, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(rootDir, src);
      return rel === '' || !SKIP.some((s) => rel === s || rel.startsWith(s + path.sep));
    }
  });
  fs.symlinkSync(path.join(rootDir, 'node_modules'), path.join(ws, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(ws, 'features'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'playwright.config.ts'), WORKSPACE_CONFIG);
  return { ws, id };
}

/** Renders the Allure HTML report from <ws>/reports/allure-results into outDir. */
function buildAllureReport(ws: string, outDir: string): boolean {
  const local = path.join(ws, 'node_modules', '.bin', 'allure');
  const bin = fs.existsSync(local) ? local : 'allure';
  try {
    execFileSync(bin, ['generate', path.join(ws, 'reports', 'allure-results'), '--clean', '-o', outDir], {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

// PRODUCT flow (run-as-a-service): selected scenarios -> generate a UI suite IN AN ISOLATED
// WORKSPACE -> run it against the entered site -> render a PER-RUN Allure report. The workspace is
// a throwaway clone (no shared cwd writes, concurrent-safe); only the report is kept and served.
app.post(
  '/api/run-suite',
  handler(async (req, res) => {
    const stories = String(req.body?.stories ?? '').trim();
    const siteUrl = String(req.body?.siteUrl ?? '').trim();
    const design = req.body?.design as TestDesign | undefined;
    const selected = (req.body?.selected as number[] | undefined) ?? [];
    if (!siteUrl || !/^https?:\/\//i.test(siteUrl)) {
      res.status(400).json({ error: 'A site URL (http/https) is required to run UI tests.' });
      return;
    }
    if (!design) {
      res.status(400).json({ error: 'Provide the design.' });
      return;
    }
    const scenarios = design.scenarios.filter((_, i) => selected.includes(i));
    if (scenarios.length === 0) {
      res.status(400).json({ error: 'Select at least one scenario.' });
      return;
    }
    const approved: TestDesign = { ...design, scenarios };

    const { ws, id } = setupWorkspace(process.cwd());
    try {
      // 1) Generate a UI suite (grounded in a live inspect) INTO the workspace.
      const mapJson = JSON.stringify(await inspectPage(siteUrl), null, 2);
      const storyText = stories || approved.understanding || approved.title;
      let artifacts = await generateTests(storyText, renderDesignMarkdown(approved), mapJson, undefined, 'ui');
      let written = writeArtifacts(artifacts, ws, { overwrite: true }, 'ui');
      let verify = verifyTypeScript(tsScope(written), ws);
      let rounds = 0;
      while (!verify.ok && rounds < 2) {
        rounds++;
        artifacts = await correctArtifacts(storyText, artifacts, verify.errors, projectSources('ui', ws), mapJson, 'ui');
        written = writeArtifacts(artifacts, ws, { overwrite: true }, 'ui');
        verify = verifyTypeScript(tsScope(written), ws);
      }
      if (!verify.ok) {
        res.json({ ok: false, stage: 'compile', rounds, errors: verify.errors });
        return;
      }

      // 2) Run ONLY the generated feature, in the workspace, against the entered site.
      const title = (artifacts.featureContent.match(/Feature:\s*(.+)/) ?? [])[1]?.trim() || '';
      const run = runFeature(title, ws, { TARGET_URL: siteUrl, BASE_URL: siteUrl });

      // 3) Render a per-run Allure report (kept after the workspace is discarded).
      const reported = buildAllureReport(ws, path.join(RUN_REPORTS_DIR, id));
      res.json({
        ok: run.ok,
        stage: 'run',
        feature: title,
        passed: run.passed,
        failed: run.failed,
        rounds,
        reportUrl: reported ? `/report/${id}/index.html` : null
      });
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  })
);

// Write previewed artifacts into the project (never overwrites existing files), then
// type-check them so the UI shows whether the generated code compiles.
app.post(
  '/api/save',
  handler(async (req, res) => {
    const artifacts = req.body?.artifacts as GeneratedArtifacts | undefined;
    if (!artifacts) {
      res.status(400).json({ error: 'Provide the artifacts to save.' });
      return;
    }
    const written = writeArtifacts(artifacts);
    const verify = verifyTypeScript(tsScope(written));
    res.json({ written, verify: { ok: verify.ok, errors: verify.errors } });
  })
);

// Self-correct already-saved artifacts until they compile (merging new members into the
// existing page objects, with a .bak backup). Up to 2 rounds.
app.post(
  '/api/fix',
  handler(async (req, res) => {
    const story = String(req.body?.story ?? '').trim();
    let artifacts = req.body?.artifacts as GeneratedArtifacts | undefined;
    const selectors = req.body?.selectors as string | undefined;
    if (!story || !artifacts) {
      res.status(400).json({ error: 'Provide the story and the artifacts to fix.' });
      return;
    }

    let written = writeArtifacts(artifacts, process.cwd(), { overwrite: true });
    let result = verifyTypeScript(tsScope(written));
    let rounds = 0;
    while (!result.ok && rounds < 2) {
      rounds++;
      artifacts = await correctArtifacts(story, artifacts, result.errors, projectSources(), selectors);
      written = writeArtifacts(artifacts, process.cwd(), { overwrite: true });
      result = verifyTypeScript(tsScope(written));
    }
    res.json({ artifacts, written, rounds, verify: { ok: result.ok, errors: result.errors } });
  })
);

// ---- Agent run sessions (Phase 3: live run + human approval over HTTP) ------
// The orchestrator drives itself; the browser follows over SSE and answers the gates.
interface RunSession {
  id: string;
  events: AgentEvent[]; // buffer so a late/refreshed client can replay
  clients: Response[]; // open SSE connections
  pending?: { gate: 'approve' | 'escalate'; resolve: (value: string) => void };
  finished: boolean;
}

const sessions = new Map<string, RunSession>();

function emitToSession(s: RunSession, e: AgentEvent): void {
  s.events.push(e);
  const frame = `data: ${JSON.stringify(e)}\n\n`;
  for (const c of s.clients) c.write(frame);
  if (e.type === 'done') {
    s.finished = true;
    for (const c of s.clients) c.end();
    s.clients = [];
  }
}

// Web IO: progress is broadcast over SSE; the approval/escalation gates park a promise that
// the /decision endpoint resolves when the human clicks.
function webIO(s: RunSession): AgentIO {
  return {
    emit: (e) => emitToSession(s, e),
    approve: () =>
      new Promise((resolve) => {
        s.pending = { gate: 'approve', resolve: (v) => resolve(v as 'yes' | 'no' | 'abort') };
      }),
    escalate: () =>
      new Promise((resolve) => {
        s.pending = { gate: 'escalate', resolve: (v) => resolve(v as 'continue' | 'halt') };
      })
  };
}

// Start an agent run in the background; the browser follows it over SSE.
app.post(
  '/api/agent/start',
  handler(async (req, res) => {
    const story = String(req.body?.story ?? '').trim();
    if (!story) {
      res.status(400).json({ error: 'Provide a user story.' });
      return;
    }
    const id = crypto.randomUUID();
    const session: RunSession = { id, events: [], clients: [], finished: false };
    sessions.set(id, session);

    // Fire and forget — progress + gates flow through webIO/SSE, not this HTTP response.
    runAgent(
      'Build and verify a reviewed BDD test suite for the given user story.',
      story,
      process.cwd(),
      {},
      webIO(session)
    ).catch((err) => {
      emitToSession(session, { type: 'error', tool: 'design', message: err?.message ?? String(err) });
      emitToSession(session, { type: 'done', outcome: 'aborted', statePath: '' });
    });

    res.json({ runId: id });
  })
);

// Live event stream for a run (Server-Sent Events).
app.get('/api/agent/:id/events', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) {
    res.status(404).json({ error: 'Unknown run.' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  for (const e of s.events) res.write(`data: ${JSON.stringify(e)}\n\n`); // replay history
  if (s.finished) {
    res.end();
    return;
  }
  s.clients.push(res);
  req.on('close', () => {
    s.clients = s.clients.filter((c) => c !== res);
  });
});

// Human decision for the gate the run is currently waiting on.
app.post(
  '/api/agent/:id/decision',
  handler(async (req, res) => {
    const s = sessions.get(String(req.params.id));
    if (!s) {
      res.status(404).json({ error: 'Unknown run.' });
      return;
    }
    if (!s.pending) {
      res.status(409).json({ error: 'The run is not waiting for a decision.' });
      return;
    }
    const value = String(req.body?.value ?? '');
    const valid = s.pending.gate === 'approve' ? ['yes', 'no', 'abort'] : ['continue', 'halt'];
    if (!valid.includes(value)) {
      res.status(400).json({ error: `Invalid decision for ${s.pending.gate}: ${value}` });
      return;
    }
    const { resolve } = s.pending;
    s.pending = undefined;
    resolve(value);
    res.json({ ok: true });
  })
);

const PORT = Number(process.env.PORT ?? 5173);
// Bind to loopback only so the endpoints (which hold the API key and write files)
// are never exposed on the network.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`NeuralQA Scenario Studio running at http://localhost:${PORT}`);
  console.log(`  Agent (live run + approval):    http://localhost:${PORT}/agent.html`);
  if (TOKEN) console.log('Token auth enabled (AIWRIGHT_TOKEN set).');
});

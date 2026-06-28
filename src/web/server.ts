import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import express, { Request, Response } from 'express';
import { designTests, renderDesignMarkdown, TestDesign } from '../ai/testDesigner';
import { generateTests, writeArtifacts, correctArtifacts, GeneratedArtifacts } from '../ai/testGenerator';
import { inspectPage, SelectorMap } from '../ai/pageInspector';
import { probeApi, EndpointMap } from '../ai/specProbe';
import { verifyTypeScript } from '../ai/verifier';
import { runAgent } from '../agent/orchestrator';
import { AgentIO, AgentEvent } from '../agent/io';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

const tsScope = (written: string[]) => written.map((w) => w.split(' ')[0]).filter((f) => f.endsWith('.ts'));

/** Reads the project source files the self-correction step may need to update. */
function projectSources(): { fileName: string; content: string }[] {
  const out: { fileName: string; content: string }[] = [];
  for (const dir of ['src/pages', 'src/fixtures']) {
    const abs = path.join(process.cwd(), dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.ts') && !f.endsWith('.generated')) {
        out.push({ fileName: f, content: fs.readFileSync(path.join(abs, f), 'utf-8') });
      }
    }
  }
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
  console.log(`aiwright web UI running at http://localhost:${PORT}`);
  console.log(`  QA agent (live run + approval): http://localhost:${PORT}/agent.html`);
  if (TOKEN) console.log('Token auth enabled (AIWRIGHT_TOKEN set).');
});

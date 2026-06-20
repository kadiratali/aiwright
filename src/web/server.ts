import * as path from 'path';
import * as fs from 'fs';
import express, { Request, Response } from 'express';
import { designTests, renderDesignMarkdown, TestDesign } from '../ai/testDesigner';
import { generateTests, writeArtifacts, correctArtifacts, GeneratedArtifacts } from '../ai/testGenerator';
import { verifyTypeScript } from '../ai/verifier';

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

const PORT = Number(process.env.PORT ?? 5173);
// Bind to loopback only so the endpoints (which hold the API key and write files)
// are never exposed on the network.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`aiwright web UI running at http://localhost:${PORT}`);
  if (TOKEN) console.log('Token auth enabled (AIWRIGHT_TOKEN set).');
});

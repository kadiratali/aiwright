import * as path from 'path';
import express, { Request, Response } from 'express';
import { designTests, renderDesignMarkdown, TestDesign } from '../ai/testDesigner';
import { generateTests, writeArtifacts, GeneratedArtifacts } from '../ai/testGenerator';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

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

// Write previewed artifacts into the project (never overwrites existing files).
app.post(
  '/api/save',
  handler(async (req, res) => {
    const artifacts = req.body?.artifacts as GeneratedArtifacts | undefined;
    if (!artifacts) {
      res.status(400).json({ error: 'Provide the artifacts to save.' });
      return;
    }
    const written = writeArtifacts(artifacts);
    res.json({ written });
  })
);

const PORT = Number(process.env.PORT ?? 5173);
app.listen(PORT, () => {
  console.log(`aiwright web UI running at http://localhost:${PORT}`);
});

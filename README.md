# aiwright — AI QA Agent

A Claude-powered BDD test automation framework built on TypeScript + **playwright-bdd**
(Gherkin → Playwright Test runner).

> **What it is — a copilot for the *first draft* of your BDD tests.**
> You describe a feature; aiwright proposes *what to test* (risk-ranked scenarios you
> curate), grounds the code in your app's **real DOM** (inspected selectors, not guesses)
> and **real API** (your existing page objects and steps), and **self-corrects until it
> compiles**. It accelerates an engineer's first draft.
>
> **What it is not** — an autonomous test writer. It keeps a human in the loop, it does not
> ship tests unreviewed, and it does not pretend to make passing tests for behaviour your
> app does not have. `tsc` verification proves the code compiles; you still own the green.

```
User Story ──▶ AI Test Designer ──▶ test-design.md  ("what to test")
                                          │   ← human reviews / edits / decides scope
Live page  ──▶ AI Page Inspector ──▶ selector-map.json  (real DOM, verified selectors)
                                          │
                                          ▼
               AI Test Generator ──▶ .feature + steps + page objects
              (scope from design, selectors from the inspected map — no guessing)
                                          │
                                          ▼
                         bddgen ──▶ Playwright Test runner
                   (fixtures, parallel runs, trace, screenshot)
                                          │
                                          ▼
              Cucumber HTML/JSON report ──▶ AI Failure Analyzer ──▶ ai-analysis.md
```

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in ANTHROPIC_API_KEY
```

## Usage

### Run the tests

```bash
npm test                  # all scenarios (parallel)
npm run test:smoke        # only @smoke tagged
npm run test:ui           # Playwright UI mode
HEADLESS=false npm test   # watch the browser
npm run report            # open the Cucumber HTML report
```

> **CI note:** the suite targets a live third-party app behind a Cloudflare bot challenge,
> which blocks GitHub's runner IPs — so the browser tests run locally, not in CI. CI gates
> on the offline checks (type-check, redaction). To run the E2E in CI, self-host the app
> under test (it ships as a Docker image) and set `TARGET_URL` to the local instance.

Reports are written under `reports/`: the Cucumber HTML/JSON report. Screenshots and traces
are collected automatically for failed scenarios (`reports/test-results/`).

### AI test design ("what to test")

Before `ai:generate` jumps to code, this produces a **test design** for a human to review
from a user story: risk areas, prioritised scenario ideas, open questions (ambiguous
requirements), assumptions, and deliberate **out-of-scope** decisions. It generates no
code — it is the "**what**" layer, not the "how".

```bash
npm run ai:design -- stories/checkout.txt
```

Output: `reports/test-design-<slug>.md`. Flow: review/edit the design → run `ai:generate`
with the scenarios you approved.

### AI selector inspection (real DOM, no guessing)

So the generator uses **real** selectors instead of guessing, this opens the live page and
extracts a stability-ranked selector map from the DOM: `data-test` > stable id >
role + accessible name > static text. It verifies each selector is unique, scopes ambiguous
ones to a stable ancestor, and collapses repeated list rows to one representative to
parametrize. With `--login` it signs in first via the project's login page.

```bash
npm run ai:inspect -- https://practicesoftwaretesting.com           # any public page
npm run ai:inspect -- https://practicesoftwaretesting.com/auth/login
```

Output: `reports/selector-map-<slug>.json`. Accepts a full URL or a path resolved against
`BASE_URL`, so it works against any site (the only site-specific part is `LoginPage`, used
only for `--login`). Page text is PII-redacted before it is written.

### AI test generation

Generates the feature file, step definitions, and the page objects needed from a user story:

```bash
npm run ai:generate -- stories/checkout.txt
# or pass text directly:
npm run ai:generate -- "As a user I want to add products to the cart so that..."
```

**Generate from an approved design (recommended flow):** with `--design`, you pass the
design file you reviewed/edited. The generator produces only the scenarios in that design —
it does not invent new ones and does not generate the ones you removed (your deliberate
scope decision):

```bash
npm run ai:generate -- stories/checkout.txt --design reports/test-design-checkout.md
```

**Ground selectors in the real DOM:** add `--selectors` with an `ai:inspect` map and the
generator uses those verified selectors verbatim instead of guessing or emitting
placeholders. `--design` and `--selectors` combine:

```bash
npm run ai:generate -- stories/checkout.txt \
  --design reports/test-design-checkout.md \
  --selectors reports/selector-map-checkout.json
```

It never overwrites an existing file — on a conflict it writes a side file with a
`.generated` extension. When a new page object is generated, the fixture-registration
snippet is included in the output notes.

### Web UI (AI QA Studio)

A small browser front end over the same pipeline: paste a user story → review the AI
design and **tick the scenarios you want** → generate the test code, preview it, and save it
into the project. The API key stays server-side.

```bash
npm run web          # http://localhost:5173
```

Endpoints (`/api/design`, `/api/generate`, `/api/save`, `/api/fix`) reuse the CLI functions
directly; the curated scenario subset becomes the authoritative scope, exactly like
`ai:generate --design`. Saving also type-checks the result, and **Auto-fix** runs the
self-correction loop. The server binds to `127.0.0.1`, rejects non-localhost `Host`
headers, and can require a shared token (`AIWRIGHT_TOKEN`).

### AI failure analysis

After a test run, analyzes the failed scenarios, classifies each as
`app-bug | test-bug | flaky | environment`, and suggests a fix:

```bash
npm test
npm run ai:analyze
```

Detailed report: `reports/ai-analysis.md`

## Worked example (real output)

Inspecting an authenticated page produces verified, stability-ranked selectors — the
repeated product rows collapse to one representative to parametrize, and nothing is guessed:

```
$ npm run ai:inspect -- https://practicesoftwaretesting.com
Practice Software Testing - Toolshop - v5.0
  Elements found    : 45
  Unique selectors  : 40
  Repeated (lists)  : 5  (parametrize per item)
  Needs disambig.   : 0
Selector map: reports/selector-map-practicesoftwaretesting-com.json
```

When a test fails, the analyzer classifies it instead of leaving you to triage:

```
$ npm run ai:analyze
[test-bug] Products heading text is exactly 'Products'   (confidence: high)
  Root cause : the step asserts "Product" but the app correctly renders "Products";
               toHaveText is exact-match, so it failed against the genuinely correct value.
  Fix        : change the step to read "Products". No app bug; no page-object change.
```

## Project Structure

```
playwright.config.ts   defineBddConfig + reporter + use settings
features/              Gherkin feature files
fixtures/              Test data (users.json, ...)
src/
  fixtures/            Playwright fixtures (page objects) + data helpers
    index.ts           test = base.extend({ loginPage, productsPage, ... })
    data.ts            loadFixture / getUser
  steps/               Step definitions (fixture-based, via createBdd)
  pages/               Page Object Model (extends BasePage)
  ai/                  Claude integration (designer + inspector + generator + analyzer + prompts)
  cli/                 ai:design / ai:inspect / ai:generate / ai:analyze commands
  web/                 Express server exposing the pipeline (npm run web)
public/                AI QA Studio single-page UI (vanilla HTML/CSS/JS)
.features-gen/         specs generated by bddgen (not committed)
```

## Sensitive Data Protection (PII)

Sensitive data such as national IDs, credit cards, and IBANs **never reaches the LLM**, and
these files cannot be read by the LLM. Three layers of protection:

1. **Isolation** — Real PII lives under `fixtures/sensitive/` and is kept out of the repo via
   `.gitignore` (only `*.example.json` templates are committed).
2. **Read-deny** — `permissions.deny` in `.claude/settings.json` prevents Claude Code (the
   coding agent) from reading `fixtures/sensitive/**` and `.env`. *(The rule takes effect in
   a new session.)*
3. **Redaction** — `ai:generate` and `ai:analyze` redact via `src/ai/redact.ts` before
   sending anything to the Claude API:
   - **Pattern-based**: national ID (11 digits), card, IBAN, email, phone
   - **Value-based (denylist)**: all real values read via `loadSensitive()` / under
     `fixtures/sensitive/` are masked verbatim even when they don't match a format (names,
     secret codes, etc.)

Redaction regression check: `npm run verify:redaction`. Detailed policy:
`fixtures/sensitive/README.md`.

## Quality scorecard

`npm run eval` scores the pipeline (redaction, project surface, and the inspector against
the live login page); `npm run eval -- --full` also checks that design produces structured
output and that generation compiles. It exits non-zero on failure, so it can gate CI —
giving a number to "how well does it work" instead of a vibe.

### Conventions

- **Steps use fixtures**: `async ({ loginPage }, param) => ...` — never write `new LoginPage(page)`.
- **Test data lives in fixtures/*.json**: no hardcoded credentials in steps; use `getUser('customer')`.
- **Selector priority**: `data-test`/`data-testid` > id > role. No brittle CSS chains.
- **Scenarios are independent**: shared setup goes in `Background`, no state shared between scenarios.

## Roadmap (per the architecture diagram)

- [x] playwright-bdd core (fixtures, POM, parallel runs, reporting)
- [x] LLM layer: user story → test design (risk/edge case/scope — "what to test")
- [x] DOM layer: live page → verified selector map (stability-ranked, no guessing)
- [x] LLM layer: user story → test generation (Claude API, structured outputs)
- [x] LLM layer: failure/risk analysis
- [ ] Jira integration (pull user stories, write results back to the issue)
- [ ] MCP server (secure access layer for tools)
- [x] CI/CD integration (GitHub Actions: test + AI analysis + artifact)
- [ ] TestRail / Slack notifications
```
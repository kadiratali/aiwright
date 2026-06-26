import { defineConfig } from '@playwright/test';
import { defineBddProject, cucumberReporter } from 'playwright-bdd';
import * as dotenv from 'dotenv';

dotenv.config();

// Two BDD projects share the features/ tree, split by tag:
//   chromium → UI scenarios (browser, page objects)        — everything NOT @api
//   api      → API scenarios (APIRequestContext, no browser) — @api only
const uiProject = defineBddProject({
  name: 'chromium',
  features: 'features/**/*.feature',
  steps: ['src/steps/*.ts', 'src/fixtures/**/*.ts'],
  tags: 'not @api'
});

const apiProject = defineBddProject({
  name: 'api',
  features: 'features/**/*.feature',
  steps: ['src/steps/api/**/*.ts', 'src/api/fixtures.ts'],
  tags: '@api'
});

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4010';

// Report file basename (under reports/). test:api overrides this to keep its report separate.
const REPORT_NAME = process.env.REPORT_NAME ?? 'cucumber-report';

// The suite targets a live external app, which is slower/colder on CI runners, so timeouts
// are generous and retries higher there to absorb cold-start latency and transient blips.
const CI = !!process.env.CI;

export default defineConfig({
  outputDir: 'reports/test-results',
  // Boots the dummy search API for the `api` project (no-op/reused for UI-only runs).
  webServer: {
    command: 'npm run mock:api',
    url: `${API_BASE_URL}/health`,
    reuseExistingServer: !CI,
    timeout: 30_000
  },
  fullyParallel: true,
  retries: CI ? 2 : 0,
  timeout: CI ? 60_000 : 30_000,
  expect: { timeout: CI ? 15_000 : 5_000 },
  // Report basename is overridable (REPORT_NAME) so the UI and API suites don't clobber each
  // other's report — e.g. test:api writes reports/api-report.{json,html}. Defaults to the UI name
  // so `npm test` / ai:analyze keep reading reports/cucumber-report.json as before.
  reporter: [
    ['list'],
    cucumberReporter('json', { outputFile: `reports/${REPORT_NAME}.json` }),
    cucumberReporter('html', { outputFile: `reports/${REPORT_NAME}.html` })
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://getmobil.com',
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
    navigationTimeout: CI ? 30_000 : 15_000,
    actionTimeout: CI ? 15_000 : 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      ...uiProject,
      use: { browserName: 'chromium' }
    },
    {
      ...apiProject,
      // API tests drive APIRequestContext directly — no browser is launched.
      use: { baseURL: API_BASE_URL }
    }
  ]
});

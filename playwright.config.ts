import { defineConfig } from '@playwright/test';
import { defineBddConfig, cucumberReporter } from 'playwright-bdd';
import * as dotenv from 'dotenv';

dotenv.config();

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['src/steps/**/*.ts', 'src/fixtures/**/*.ts']
});

// The suite targets a live external app, which is slower/colder on CI runners, so timeouts
// are generous and retries higher there to absorb cold-start latency and transient blips.
const CI = !!process.env.CI;

export default defineConfig({
  testDir,
  outputDir: 'reports/test-results',
  fullyParallel: true,
  retries: CI ? 2 : 0,
  timeout: CI ? 60_000 : 30_000,
  expect: { timeout: CI ? 15_000 : 5_000 },
  reporter: [
    ['list'],
    cucumberReporter('json', { outputFile: 'reports/cucumber-report.json' }),
    cucumberReporter('html', { outputFile: 'reports/cucumber-report.html' })
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://practicesoftwaretesting.com',
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
    navigationTimeout: CI ? 30_000 : 15_000,
    actionTimeout: CI ? 15_000 : 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' }
    }
  ]
});

// Warms the self-hosted dev app before the E2E suite runs: a cold `ng serve` compiles
// lazy route chunks on first navigation and the API boots on first request, which can
// exceed test timeouts. Loading the key routes here pays that cost once, up front.
import { chromium } from '@playwright/test';

const url = process.env.TARGET_URL || 'http://localhost:4200';
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-test="product-name"]').first().waitFor({ state: 'visible', timeout: 120_000 });
  console.log('warm-up: home + products ready');

  await page.goto(`${url}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-test="email"]').waitFor({ state: 'visible', timeout: 120_000 });
  console.log('warm-up: login route ready');
} finally {
  await browser.close();
}

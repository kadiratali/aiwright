import { chromium, type BrowserContext } from '@playwright/test';

/** Playwright's storage state (cookies + localStorage) — the saved logged-in session. */
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export interface AuthOptions {
  loginUrl: string;
  username: string;
  password: string;
}

/**
 * Logs into a site by heuristically filling its login form — the password field, the nearest
 * username/email/text field, and a submit button (or Enter) — and returns the resulting
 * storageState. That session is then reused for an authenticated inspect/run, so the tooling
 * sees the app BEHIND the login wall instead of the login page.
 *
 * Heuristic on purpose (login forms vary); a future version can take explicit selectors.
 */
export async function authenticate(opts: AuthOptions): Promise<StorageState> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(opts.loginUrl, { waitUntil: 'domcontentloaded' });

    const password = page.locator('input[type="password"]').first();
    await password.waitFor({ state: 'visible', timeout: 10_000 });

    // Username: an email/text/named/un-typed input that isn't the password.
    const username = page
      .locator(
        'input[type="email"], input[name*="user" i], input[name*="email" i], input[type="text"], input:not([type])'
      )
      .first();
    await username.fill(opts.username);
    await password.fill(opts.password);

    const submit = page
      .locator('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Giriş")')
      .first();
    if (await submit.count()) await submit.click();
    else await password.press('Enter');

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const state = await context.storageState();
    const hasSession = (state.cookies?.length ?? 0) > 0 || (state.origins?.length ?? 0) > 0;
    if (!hasSession) {
      throw new Error('Login produced no session — check the credentials or the login URL.');
    }
    return state;
  } finally {
    await browser.close();
  }
}

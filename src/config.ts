/**
 * Single source of truth for the application under test.
 *
 * Page objects navigate with absolute URLs built from this, so retargeting the whole
 * suite to a different app is a one-line change (or set TARGET_URL in the environment).
 * Kept separate from Playwright's BASE_URL so it is not affected by a stale .env value.
 */
export const TARGET_URL = process.env.TARGET_URL ?? 'https://practicesoftwaretesting.com';

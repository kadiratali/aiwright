import { test as bddBase } from 'playwright-bdd';

/**
 * Health guard on EVERY UI test (auto fixture): collects page health signals — uncaught JS errors
 * and SAME-ORIGIN 5xx responses (the classes DOM assertions miss: "renders but the JS broke",
 * "the API 500'd but the UI swallowed it").
 *
 * REPORT-ONLY by default: real sites are noisy (third-party console errors etc.), so a hard fail
 * would turn healthy suites red. Instead the signals are attached to the test (visible in the
 * report). Set NQ_HEALTH_GUARD=1 to make them FAIL the test (strict mode, e.g. for your own app).
 *
 * In its own module so it survives generation rewriting src/fixtures/index.ts (that file extends
 * THIS test, keeping the guard applied to every page-object suite).
 */
export const test = bddBase.extend<{ pageHealth: void }>({
  pageHealth: [
    async ({ page, baseURL }, use, testInfo) => {
      const problems: string[] = [];
      let origin = '';
      try {
        origin = new URL(baseURL ?? '').origin;
      } catch {
        /* no baseURL */
      }
      page.on('pageerror', (e) => problems.push(`Uncaught JS error: ${e.message}`));
      page.on('response', (r) => {
        try {
          if (r.status() >= 500 && (!origin || new URL(r.url()).origin === origin)) {
            problems.push(`HTTP ${r.status()} — ${r.url()}`);
          }
        } catch {
          /* ignore unparseable URLs */
        }
      });

      await use();

      if (problems.length) {
        testInfo.annotations.push({ type: 'page-health', description: problems.join(' | ') });
        if (process.env.NQ_HEALTH_GUARD) {
          throw new Error('Page health check failed:\n- ' + problems.join('\n- '));
        }
      }
    },
    { auto: true }
  ]
});

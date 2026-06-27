/**
 * aiwright project config — the ONE place to retarget the suite to a different application.
 *
 * Change these values (or override any of them via the matching env var) and the whole pipeline
 * follows: `inspect` opens `targetUrl`, `probe` reads `openApiSpec` against `apiBaseUrl`, the api
 * fixtures and `heal-contract` call `apiBaseUrl`, and the inspector recognises `testIdAttributes`
 * when building selectors. Nothing else hardcodes the app under test.
 *
 * The bundled values point at the example getmobil.com suite; replace them for your app.
 */
export interface AiwrightConfig {
  /** Base URL of the UI under test — browser navigation + `inspect`. Env override: TARGET_URL / BASE_URL. */
  targetUrl: string;
  /** Base URL of the API under test — `probe`, the api fixtures, `heal-contract`. Env override: API_BASE_URL. */
  apiBaseUrl: string;
  /** Path to the OpenAPI spec `probe` grounds API generation in. Env override: OPENAPI_SPEC. */
  openApiSpec: string;
  /**
   * test-id attribute conventions the inspector recognises, in PRIORITY order (most stable
   * first). getmobil exposes data-test-id="selenium-*"; another app might use only data-testid.
   * The inspector builds each selector from the actual attribute it finds in this list.
   */
  testIdAttributes: string[];
}

const config: AiwrightConfig = {
  targetUrl: 'https://getmobil.com',
  apiBaseUrl: 'http://localhost:4010',
  openApiSpec: 'docs/api/openapi.json',
  testIdAttributes: [
    'data-test',
    'data-testid',
    'data-test-id',
    'data-cy',
    'data-qa',
    'data-automation-id',
    'data-e2e'
  ]
};

export default config;

import { test as base } from 'playwright-bdd';
import type { APIRequestContext } from '@playwright/test';
import { SearchApi } from './clients/SearchApi';
import type { SearchResult } from './clients/SearchApi';

/**
 * Fixtures for the browserless `api` project (see playwright.config.ts). The `apiClient` is an
 * APIRequestContext bound to API_BASE_URL — the one place auth/baseURL/headers would live.
 * `searchState` is a tiny mutable world so a When-step's response can be asserted in Then-steps.
 *
 * API client fixtures are wired here as they are generated (one `xxxApi` per resource client),
 * mirroring how page-object fixtures are wired in src/fixtures/index.ts.
 */
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4010';

type ApiFixtures = {
  apiClient: APIRequestContext;
  searchApi: SearchApi;
  searchState: { last?: SearchResult };
};

export const test = base.extend<ApiFixtures>({
  apiClient: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: API_BASE_URL });
    await use(ctx);
    await ctx.dispose();
  },
  searchApi: async ({ apiClient }, use) => use(new SearchApi(apiClient)),
  searchState: async ({}, use) => use({})
});

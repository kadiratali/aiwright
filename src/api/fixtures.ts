import { test as base } from 'playwright-bdd';
import type { APIRequestContext } from '@playwright/test';
import { SearchApi } from './clients/SearchApi';
import { ProductApi } from './clients/ProductApi';

/**
 * Fixtures for the browserless `api` project (see playwright.config.ts). The `apiClient` is an
 * APIRequestContext bound to API_BASE_URL — the one place auth/baseURL/headers would live.
 *
 * `apiState` is ONE shared mutable holder for the last response, so generic steps (status,
 * error shape, …) are defined once and reused across every resource — a When step stores its
 * result here, the Then steps assert against it. Per-resource state fixtures would force each
 * resource to redefine those generic steps (a playwright-bdd duplicate-definition error).
 *
 * API client fixtures are wired here as they are generated (one `xxxApi` per resource client),
 * mirroring how page-object fixtures are wired in src/fixtures/index.ts.
 */
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4010';

/** The last API response, shared across steps. `body` is unknown — Then steps narrow it. */
export interface ApiResponse {
  status: number;
  body: unknown;
}

type ApiFixtures = {
  apiClient: APIRequestContext;
  searchApi: SearchApi;
  productApi: ProductApi;
  apiState: { last?: ApiResponse };
};

export const test = base.extend<ApiFixtures>({
  apiClient: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: API_BASE_URL });
    await use(ctx);
    await ctx.dispose();
  },
  searchApi: async ({ apiClient }, use) => use(new SearchApi(apiClient)),
  productApi: async ({ apiClient }, use) => use(new ProductApi(apiClient)),
  apiState: async ({}, use) => use({})
});

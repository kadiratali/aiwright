import { expect } from '@playwright/test';
import { Given, When, Then } from './common';

/**
 * Generic, resource-agnostic API steps — defined ONCE here and reused by every resource's
 * feature. They read the shared `apiState`, which each resource's When step populates.
 * Resource-specific assertions live in that resource's own *.api.steps.ts.
 */

Given('the API is up', async ({ apiClient }) => {
  const res = await apiClient.get('/health');
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe('ok');
});

Then('the response status is {int}', async ({ apiState }, code: number) => {
  expect(apiState.last, 'a request must be made first').toBeDefined();
  expect(apiState.last!.status).toBe(code);
});

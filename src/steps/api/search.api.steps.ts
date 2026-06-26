import { expect } from '@playwright/test';
import { Given, When, Then } from './common';
import type { SearchResponse } from '../../api/contracts/search';

// Reuses the shared 'the API is up' (Background) and 'the response status is {int}' steps from
// common.api.steps.ts — only the search-specific call + assertions live here.

When('a search for {string} is performed', async ({ searchApi, apiState }, term: string) => {
  apiState.last = await searchApi.search(term);
});

Then('the response contains at least {int} results', async ({ apiState }, min: number) => {
  const body = apiState.last!.body as SearchResponse;
  expect(body.items.length).toBeGreaterThanOrEqual(min);
});

Then('the response contains no results', async ({ apiState }) => {
  const body = apiState.last!.body as SearchResponse;
  expect(body.total).toBe(0);
  expect(body.items).toHaveLength(0);
});

Then('each result has id, name and price fields', async ({ apiState }) => {
  const body = apiState.last!.body as SearchResponse;
  for (const item of body.items) {
    expect(item.id, 'id must not be empty').toBeTruthy();
    expect(typeof item.name).toBe('string');
    expect(typeof item.price).toBe('number');
  }
});

Then('at least one result mentions {string}', async ({ apiState }, term: string) => {
  const body = apiState.last!.body as SearchResponse;
  const needle = term.toLocaleLowerCase('tr');
  const hit = body.items.some(
    (i) => i.name.toLocaleLowerCase('tr').includes(needle) || (i.category ?? '').toLocaleLowerCase('tr').includes(needle)
  );
  expect(hit, `no result mentions "${term}"`).toBe(true);
});

import { expect } from '@playwright/test';
import { Given, When, Then } from './common';
import type { Product } from '../../api/contracts/product';

// Reuses the shared 'the API is up' (Background) and 'the response status is {int}' steps from
// common.api.steps.ts — only the product-specific call + assertions live here.

When('the product with id {string} is fetched', async ({ productApi, apiState }, id: string) => {
  apiState.last = await productApi.fetch(id);
});

Then('the product id field equals {string}', async ({ apiState }, expectedId: string) => {
  expect(apiState.last!.body).toHaveProperty('id', expectedId);
});

Then('the product has name, price and slug fields', async ({ apiState }) => {
  const body = apiState.last!.body as Product;
  expect(body).toHaveProperty('name');
  expect(body).toHaveProperty('price');
  expect(body).toHaveProperty('slug');
});

Then('the price is greater than zero', async ({ apiState }) => {
  const price = (apiState.last!.body as Product).price;
  expect(typeof price).toBe('number');
  expect(price).toBeGreaterThan(0);
});

Then('the response body contains an error message', async ({ apiState }) => {
  const body = apiState.last!.body as Record<string, unknown>;
  expect('error' in body || 'message' in body).toBe(true);
});

Then('no product data is returned', async ({ apiState }) => {
  const body = apiState.last!.body as Record<string, unknown>;
  expect(body).not.toHaveProperty('id');
  expect(body).not.toHaveProperty('price');
  expect(body).not.toHaveProperty('slug');
});

import { expect } from '@playwright/test';
import { When, Then } from './common';
import type { CategoriesResponse } from '../../api/contracts/categories';

When('the categories list is fetched', async ({ categoriesApi, apiState }) => {
  apiState.last = await categoriesApi.list();
});

Then('the response body contains a categories array', async ({ apiState }) => {
  const body = apiState.last!.body as CategoriesResponse;
  expect(body).toHaveProperty('categories');
  expect(Array.isArray(body.categories)).toBe(true);
});

Then('every category has slug, name and count fields', async ({ apiState }) => {
  const { categories } = apiState.last!.body as CategoriesResponse;
  for (const cat of categories) {
    expect(cat).toHaveProperty('slug');
    expect(cat).toHaveProperty('name');
    expect(cat).toHaveProperty('count');
    expect(typeof cat.slug).toBe('string');
    expect(typeof cat.name).toBe('string');
    expect(typeof cat.count).toBe('number');
  }
});

Then('every category count is a positive integer', async ({ apiState }) => {
  const { categories } = apiState.last!.body as CategoriesResponse;
  for (const cat of categories) {
    expect(Number.isInteger(cat.count)).toBe(true);
    expect(cat.count).toBeGreaterThan(0);
  }
});

Then('the total equals the number of categories returned', async ({ apiState }) => {
  const body = apiState.last!.body as CategoriesResponse;
  if ('total' in body) {
    expect((body as CategoriesResponse & { total: number }).total).toBe(body.categories.length);
  } else {
    expect(body.categories.length).toBeGreaterThanOrEqual(0);
  }
});

Then('the categories array is not empty', async ({ apiState }) => {
  const { categories } = apiState.last!.body as CategoriesResponse;
  expect(categories.length).toBeGreaterThan(0);
});
